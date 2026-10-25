"""Feed service: hybrid fan-out + read-merge for celebrities."""

from __future__ import annotations

import time
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.core.feature_flags import get_flags
from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.feed.cache import FEED_CACHE_CAP, FeedCache
from social_api.modules.feed.repository import FeedRepository
from social_api.modules.feed.schemas import HomeFeedPage
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.posts.models import Post
from social_api.modules.posts.repository import PostsRepository
from social_api.modules.posts.service import _to_view
from social_api.modules.users.models import Visibility

logger = get_logger(__name__)


def _observe_feed_generation(seconds: float) -> None:
    try:
        from social_api.observability.metrics import feed_generation_seconds

        feed_generation_seconds.labels(type="home").observe(seconds)
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="feed_generation",
            error=type(exc).__name__,
        )


def _observe_cache_hit() -> None:
    try:
        from social_api.observability.metrics import feed_cache_hits

        feed_cache_hits.labels(type="home").inc()
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="feed_cache_hits",
            error=type(exc).__name__,
        )


def _observe_cache_miss() -> None:
    try:
        from social_api.observability.metrics import feed_cache_misses

        feed_cache_misses.labels(type="home").inc()
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="feed_cache_misses",
            error=type(exc).__name__,
        )


class FeedService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = FeedRepository(session)
        self._posts = PostsRepository(session)
        self._likes = LikesRepository(session)
        self._cache = FeedCache(get_redis())

    async def _is_post_visible(
        self, post: Post, *, viewer_id: int, following_set: set[int]
    ) -> bool:
        if post.author_id == viewer_id:
            return True
        if post.visibility == Visibility.PRIVATE:
            return False
        if post.visibility == Visibility.FOLLOWERS:
            return post.author_id in following_set
        return True

    async def _celebrity_authors(self, *, following_set: set[int]) -> set[int]:
        """
        Return subset of `following_set` whose follower count ≥ threshold.
        Empty if fanout feature flag is off.
        """
        if not get_flags().is_enabled("feed_fanout_enabled"):
            return set()
        if not following_set:
            return set()
        threshold = get_settings().feed_fanout_threshold
        counts = await self._repo.follower_counts_batch(user_ids=list(following_set))
        return {uid for uid, c in counts.items() if c >= threshold}

    async def home(
        self,
        *,
        user_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> HomeFeedPage:
        started = time.perf_counter()
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

        # Cache only helps page 1
        cache_hit = False
        cached_ids: list[tuple[int, float]] = []
        if cts is None:
            try:
                cached_ids = await self._cache.get_ids(user_id=user_id, limit=lmt + 1)
                cache_hit = bool(cached_ids)
            except Exception as exc:  # pragma: no cover
                logger.warning("feed_cache_read_failed", error=type(exc).__name__)
                cached_ids = []
                cache_hit = False

        following_ids = await self._repo.following_ids(user_id=user_id)
        following_set = set(following_ids)

        if cache_hit:
            post_ids = [pid for pid, _score in cached_ids]
            rows = await self._repo.fetch_posts_by_ids(post_ids=post_ids)

            author_ids = list({p.author_id for p in rows})
            blocked_authors = await self._repo.blocked_with_author_ids(
                viewer_id=user_id, author_ids=author_ids
            )

            visible: list[Post] = []
            for p in rows:
                if p.author_id in blocked_authors:
                    continue
                if not await self._is_post_visible(
                    p, viewer_id=user_id, following_set=following_set
                ):
                    continue
                visible.append(p)
            _observe_cache_hit()
        else:
            rows = await self._repo.fetch_feed_posts_for_rebuild(
                user_id=user_id, cap=FEED_CACHE_CAP
            )
            visible = [
                p
                for p in rows
                if await self._is_post_visible(p, viewer_id=user_id, following_set=following_set)
            ]
            try:
                await self._cache.replace(
                    user_id=user_id,
                    entries=[(p.id, p.created_at) for p in rows],
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("feed_cache_write_failed", error=type(exc).__name__)
            _observe_cache_miss()

        # --- Celebrity read-merge ---
        # Only on page 1 (fresh feed); pagination on page 2+ uses DB rebuild path.
        if cts is None:
            celebrity_ids = await self._celebrity_authors(following_set=following_set)
            if celebrity_ids:
                celeb_posts = await self._repo.celebrity_following_posts(
                    user_id=user_id,
                    celebrity_ids=list(celebrity_ids),
                    limit=lmt + 1,
                )
                # Merge (dedupe by id)
                seen = {p.id for p in visible}
                for cp in celeb_posts:
                    if cp.id in seen:
                        continue
                    if not await self._is_post_visible(
                        cp, viewer_id=user_id, following_set=following_set
                    ):
                        continue
                    visible.append(cp)
                    seen.add(cp.id)
                # Re-sort by (created_at, id) desc
                visible.sort(key=lambda p: (p.created_at, p.id), reverse=True)

        # Cursor filter for page 2+
        if cts is not None and cid is not None:
            visible = [p for p in visible if (p.created_at, p.id) < (cts, cid)]

        page_items = visible[:lmt]
        next_cursor: str | None = None
        if len(visible) > lmt:
            last = page_items[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        post_ids_page = [p.id for p in page_items]
        liked_ids = await self._likes.exists_batch(
            user_id=user_id, target_type="post", target_ids=post_ids_page
        )

        elapsed = time.perf_counter() - started
        _observe_feed_generation(elapsed)

        return HomeFeedPage(
            items=[_to_view(p, is_liked=p.id in liked_ids) for p in page_items],
            next_cursor=next_cursor,
            cache_hit=cache_hit,
        )

    # ---- Invalidation hooks ----
    async def invalidate_for_new_post(self, *, author_id: int) -> None:
        followers = await self._repo.follower_ids(user_id=author_id)
        await self._cache.invalidate_many(user_ids=[*followers, author_id])
        logger.info(
            "feed_invalidated_new_post",
            author_id=author_id,
            followers_count=len(followers),
        )

    async def invalidate_for_follow_change(self, *, follower_id: int) -> None:
        await self._cache.invalidate(user_id=follower_id)

    async def invalidate_for_block(self, *, a_id: int, b_id: int) -> None:
        await self._cache.invalidate_many(user_ids=[a_id, b_id])

    async def invalidate_for_mute(self, *, muter_id: int) -> None:
        await self._cache.invalidate(user_id=muter_id)
