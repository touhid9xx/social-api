"""Comments service."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError, ForbiddenError
from social_api.logging_config import get_logger
from social_api.modules.auth.models import User, UserRole
from social_api.modules.comments.models import MAX_COMMENT_DEPTH, Comment
from social_api.modules.comments.repository import CommentsRepository
from social_api.modules.comments.schemas import (
    CommentCreate,
    CommentPage,
    CommentUpdate,
    CommentView,
)
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.posts.exceptions import (
    CommentDepthExceededError,
    CommentForbiddenError,
    CommentNotFoundError,
    PostNotFoundError,
)
from social_api.modules.posts.repository import PostsRepository

logger = get_logger(__name__)


def _to_view(
    c: Comment, *, is_liked: bool = False, replies: list[Comment] | None = None
) -> CommentView:
    return CommentView(
        id=c.id,
        post_id=c.post_id,
        author_id=c.author_id,
        parent_id=c.parent_id,
        depth=c.depth,
        body=c.body,
        like_count=c.like_count,
        created_at=c.created_at,
        updated_at=c.updated_at,
        is_liked_by_me=is_liked,
        is_edited=c.updated_at > c.created_at,
        replies=[_to_view(r) for r in (replies or [])],
    )


class CommentsService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = CommentsRepository(session)
        self._posts = PostsRepository(session)
        self._likes = LikesRepository(session)

    async def create(self, *, viewer_id: int, post_id: int, payload: CommentCreate) -> CommentView:
        post = await self._posts.get_by_id(post_id)
        if post is None:
            raise PostNotFoundError()

        depth = 1
        if payload.parent_id is not None:
            parent = await self._repo.get_by_id(payload.parent_id)
            if parent is None or parent.post_id != post_id:
                raise CommentNotFoundError()
            depth = parent.depth + 1
            if depth > MAX_COMMENT_DEPTH:
                raise CommentDepthExceededError()

        c = await self._repo.create(
            post_id=post_id,
            author_id=viewer_id,
            parent_id=payload.parent_id,
            depth=depth,
            body=payload.body,
        )
        await self._repo.increment_post_comment_count(post_id=post_id)
        logger.info("comment_created", comment_id=c.id, post_id=post_id)
        return _to_view(c)

    async def update(
        self, *, viewer_id: int, comment_id: int, payload: CommentUpdate
    ) -> CommentView:
        c = await self._repo.get_by_id(comment_id)
        if c is None:
            raise CommentNotFoundError()
        if c.author_id != viewer_id:
            raise CommentForbiddenError()
        if c.version != payload.version:
            from social_api.modules.users.exceptions import OptimisticLockError

            raise OptimisticLockError(
                detail={
                    "current_version": c.version,
                    "current": _to_view(c).model_dump(),
                }
            )
        c.body = payload.body
        c.version += 1
        await self._repo.save(c)
        return _to_view(c)

    async def delete(self, *, actor: User, comment_id: int) -> None:
        c = await self._repo.get_by_id(comment_id)
        if c is None:
            raise CommentNotFoundError()
        is_owner = c.author_id == actor.id
        is_staff = actor.role in (UserRole.MODERATOR, UserRole.ADMIN)
        if not (is_owner or is_staff):
            raise ForbiddenError()

        c.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save(c)
        await self._repo.decrement_post_comment_count(post_id=c.post_id)
        logger.info("comment_deleted", comment_id=comment_id, actor_id=actor.id)

    async def list_for_post(
        self,
        *,
        viewer_id: int,
        post_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> CommentPage:
        post = await self._posts.get_by_id(post_id)
        if post is None:
            raise PostNotFoundError()

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

        rows = await self._repo.list_for_post(
            post_id=post_id, cursor_ts=cts, cursor_id=cid, limit=lmt
        )
        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        # Load replies for each top-level comment
        views: list[CommentView] = []
        for r in rows:
            replies = await self._repo.list_replies(parent_id=r.id)
            liked = await self._likes.exists(
                user_id=viewer_id, target_type="comment", target_id=r.id
            )
            views.append(_to_view(r, is_liked=liked, replies=replies))

        return CommentPage(items=views, next_cursor=next_cursor)
