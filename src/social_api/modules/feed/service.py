"""Feed service: read fan-out + cache-aside."""

from __future__ import annotations

import time
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.cache.redis import get_redis
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
    """Best-effort metric (prometheus may not be configured in unit tests)."""
    try:
        from social_api.observability.metrics import feed_generation_seconds

        feed_generation_seconds.labels(type="home").observe(seconds)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("metric_observe_failed", metric="feed_generation", error=type(exc).__name__)


def _observe_cache_hit() -> None:
    try:
        from social_api.observability.metrics import feed_cache_hits

        feed_cache_hits.labels(type="home").inc()
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("metric_observe_failed", metric="feed_cache_hits", error=type(exc).__name__)


def _observe_cache_miss() -> None:
    try:
        from social_api.observability.metrics import feed_cache_misses

        feed_cache_misses.labels(type="home").inc()
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("metric_observe_failed", metric="feed_cache_misses", error=type(exc).__name__)


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
        """Visibility gate: same semantics as /posts/{id}."""
        if post.author_id == viewer_id:
            return True
        if post.visibility == Visibility.PRIVATE:
            return False
        if post.visibility == Visibility.FOLLOWERS:
            return post.author_id in following_set
        return True  # public

    async def home(
        self,
        *,
        user_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> HomeFeedPage:
        started = time.perf_counter()
        lmt = clamp_limit(limit)

        # Decode cursor
        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None

        # --- Try cache (only page 1 has cache benefit) ---
        cache_hit = False
        cached_ids: list[tuple[int, float]] = []
        if cts is None:
            try:
                cached_ids = await self._cache.get_ids(user_id=user_id, limit=lmt + 1)
                cache_hit = bool(cached_ids)
            except Exception as exc:  # pragma: no cover — Redis down fallback
                logger.warning("feed_cache_read_failed", error=type(exc).__name__)
                cached_ids = []
                cache_hit = False

        following_ids = await self._repo.following_ids(user_id=user_id)
        following_set = set(following_ids)

        if cache_hit:
            post_ids = [pid for pid, _score in cached_ids]
            rows = await self._repo.fetch_posts_by_ids(post_ids=post_ids)

            # Batch block check (single query)
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
            except Exception as exc:  # pragma: no cover — Redis down fallback
                logger.warning("feed_cache_write_failed", error=type(exc).__name__)
            _observe_cache_miss()

        # --- Pagination: apply cursor on visible list ---
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

    # ---- Invalidation hooks (called by other services) ----
    async def invalidate_for_new_post(self, *, author_id: int) -> None:
        """
        On new post: clear author's own cache + every follower's cache.

        For a user with F followers, this deletes F+1 keys. M10 write-fanout
        replaces this with pushing into each ZSET (no full rebuild).
        """
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
        """Mute changes what the muter sees — invalidate their feed."""
        await self._cache.invalidate(user_id=muter_id)
