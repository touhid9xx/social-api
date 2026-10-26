"""Posts service - create/get/update/delete with visibility + blocks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.config import get_settings
from social_api.core.feature_flags import get_flags
from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError, ForbiddenError
from social_api.logging_config import get_logger
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.repository import UserRepository
from social_api.modules.follows.repository import FollowsRepository
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.posts.exceptions import (
    PostForbiddenError,
    PostNotFoundError,
)
from social_api.modules.posts.models import Post
from social_api.modules.posts.repository import PostsRepository
from social_api.modules.posts.schemas import (
    PostCreate,
    PostPage,
    PostUpdate,
    PostView,
)
from social_api.modules.users.exceptions import OptimisticLockError
from social_api.modules.users.models import Visibility
from social_api.workers.tasks.feed_fanout import enqueue_fanout

logger = get_logger(__name__)

_RoleLiteral = Literal["user", "moderator", "admin"]


def _to_view(post: Post, *, is_liked: bool = False) -> PostView:
    return PostView(
        id=post.id,
        author_id=post.author_id,
        body=post.body,
        visibility=post.visibility.value,
        like_count=post.like_count,
        comment_count=post.comment_count,
        media_count=post.media_count,
        version=post.version,
        created_at=post.created_at,
        updated_at=post.updated_at,
        is_liked_by_me=is_liked,
        # Version is a monotone counter (1 at create, +1 on each update).
        # `version > 1` reliably means "edited at least once" and is
        # immune to the second-precision truncation of MySQL DATETIME
        # that makes `updated_at > created_at` fail on fast edits.
        is_edited=post.version > 1,
    )


class PostsService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = PostsRepository(session)
        self._likes = LikesRepository(session)
        self._follows = FollowsRepository(session)
        self._users = UserRepository(session)

    # ---- Authorization helper ----
    async def _assert_visible(
        self, *, viewer_id: int, author_id: int, visibility: Visibility
    ) -> None:
        if viewer_id == author_id:
            return
        if visibility == Visibility.PRIVATE:
            raise PostNotFoundError()  # 404 — don't leak existence
        if visibility == Visibility.FOLLOWERS and not await self._follows.is_following(
            follower_id=viewer_id, followee_id=author_id
        ):
            raise PostNotFoundError()
        if await self._follows.blocked_either_direction(viewer_id, author_id):
            raise PostNotFoundError()

    # ---- Create ----
    async def create(self, *, author_id: int, payload: PostCreate) -> PostView:
        post = await self._repo.create(
            author_id=author_id, body=payload.body, visibility=payload.visibility
        )

        await self._dispatch_feed_for_new_post(
            post_id=post.id,
            author_id=author_id,
            created_at=post.created_at,
        )

        try:
            from social_api.observability.metrics import posts_created_total

            posts_created_total.inc()
        except Exception as exc:  # pragma: no cover
            logger.debug(
                "metric_inc_failed",
                metric="posts_created_total",
                error=type(exc).__name__,
            )

        logger.info("post_created", post_id=post.id, author_id=author_id)
        return _to_view(post)

    async def _dispatch_feed_for_new_post(
        self, *, post_id: int, author_id: int, created_at: datetime
    ) -> None:
        try:
            if not get_flags().is_enabled("feed_fanout_enabled"):
                from social_api.modules.feed.service import FeedService

                await FeedService(self._s).invalidate_for_new_post(author_id=author_id)
                return

            threshold = get_settings().feed_fanout_threshold
            followers = await self._repo.followers_of(user_id=author_id, limit=threshold)
            if len(followers) >= threshold:
                # Celebrity — no write-fanout, read-merge handles it.
                from social_api.modules.feed.service import FeedService

                await FeedService(self._s).invalidate_for_new_post(author_id=author_id)
                logger.info(
                    "feed_fanout_skipped_celebrity",
                    post_id=post_id,
                    author_id=author_id,
                    follower_count=len(followers),
                )
                return

            # Normal author — queue fanout via typed wrapper.
            enqueue_fanout(
                post_id=post_id,
                author_id=author_id,
                created_at_iso=created_at.isoformat(),
                follower_ids=followers,
            )
            logger.info(
                "feed_fanout_queued",
                post_id=post_id,
                author_id=author_id,
                followers=len(followers),
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "feed_dispatch_failed",
                post_id=post_id,
                error=type(exc).__name__,
            )

    # ---- Get ----
    async def get(self, *, viewer_id: int, post_id: int) -> PostView:
        post = await self._repo.get_by_id(post_id)
        if post is None:
            raise PostNotFoundError()
        await self._assert_visible(
            viewer_id=viewer_id,
            author_id=post.author_id,
            visibility=post.visibility,
        )
        liked = await self._likes.exists(user_id=viewer_id, target_type="post", target_id=post.id)
        return _to_view(post, is_liked=liked)

    # ---- Update ----
    async def update(self, *, viewer_id: int, post_id: int, payload: PostUpdate) -> PostView:
        post = await self._repo.get_by_id(post_id)
        if post is None:
            raise PostNotFoundError()
        if post.author_id != viewer_id:
            raise PostForbiddenError()
        if post.version != payload.version:
            # mode="json" — datetime-safe; the error handler uses
            # plain json.dumps() inside JSONResponse.
            raise OptimisticLockError(
                detail={
                    "current_version": post.version,
                    "current": _to_view(post).model_dump(mode="json"),
                }
            )

        if payload.body is not None:
            post.body = payload.body
        if payload.visibility is not None:
            post.visibility = Visibility(payload.visibility)
        post.version += 1
        await self._repo.save(post)
        logger.info("post_updated", post_id=post.id)
        return _to_view(post)

    # ---- Delete (soft) ----
    async def delete(self, *, actor: User, post_id: int) -> None:
        post = await self._repo.get_by_id(post_id)
        if post is None:
            raise PostNotFoundError()

        is_owner = post.author_id == actor.id
        is_staff = actor.role in (UserRole.MODERATOR, UserRole.ADMIN)
        if not (is_owner or is_staff):
            raise ForbiddenError()

        post.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save(post)

        try:
            from social_api.modules.feed.service import FeedService

            await FeedService(self._s).invalidate_for_new_post(author_id=post.author_id)
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "feed_invalidate_failed",
                post_id=post.id,
                error=type(exc).__name__,
            )

        logger.info(
            "post_deleted",
            post_id=post.id,
            actor_id=actor.id,
            as_staff=is_staff and not is_owner,
        )

    # ---- List by author ----
    async def list_by_author(
        self,
        *,
        viewer_id: int,
        author_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> PostPage:
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None

        posts = await self._repo.list_by_author(
            author_id=author_id,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        visible: list[Post] = []
        for p in posts:
            try:
                await self._assert_visible(
                    viewer_id=viewer_id,
                    author_id=p.author_id,
                    visibility=p.visibility,
                )
            except PostNotFoundError:
                continue
            visible.append(p)

        next_cursor: str | None = None
        if len(posts) > lmt:
            last_raw = posts[:lmt][-1]
            next_cursor = encode_cursor([last_raw.created_at, last_raw.id])
            visible = visible[:lmt]

        post_ids = [p.id for p in visible]
        liked_ids = await self._likes.exists_batch(
            user_id=viewer_id, target_type="post", target_ids=post_ids
        )

        return PostPage(
            items=[_to_view(p, is_liked=p.id in liked_ids) for p in visible],
            next_cursor=next_cursor,
        )
