"""Feed service: hybrid fan-out + read-merge for celebrities."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.cache.redis import get_redis, guarded
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
from social_api.modules.feed.schemas import ExploreFeedPage, HomeFeedPage
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.posts.models import Post
from social_api.modules.posts.repository import PostsRepository
from social_api.modules.posts.service import _to_view
from social_api.modules.users.models import Visibility

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Metric helpers (kept inline; see TODO M21 for a metrics facade)
# ---------------------------------------------------------------------------
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


def _observe_cache_hit_explore() -> None:
    try:
        from social_api.observability.metrics import feed_cache_hits

        feed_cache_hits.labels(type="explore").inc()
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="feed_cache_hits",
            type="explore",
            error=type(exc).__name__,
        )


def _observe_cache_miss_explore() -> None:
    try:
        from social_api.observability.metrics import feed_cache_misses

        feed_cache_misses.labels(type="explore").inc()
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="feed_cache_misses",
            type="explore",
            error=type(exc).__name__,
        )


def _observe_explore_generation(seconds: float) -> None:
    try:
        from social_api.observability.metrics import explore_generation_seconds

        explore_generation_seconds.labels(type="explore").observe(seconds)
    except Exception as exc:  # pragma: no cover
        logger.debug(
            "metric_observe_failed",
            metric="explore_generation_seconds",
            type="explore",
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
        """Subset of following_set whose follower count ≥ threshold.

        TODO(M21): cache follower-counts per author with a short TTL to
        avoid re-running the GROUP BY on every page-1 request. At 1M
        users and 500-follow viewers this is a real cost.
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
            cached_ids = await guarded(
                lambda: self._cache.get_ids(user_id=user_id, limit=lmt + 1),
                default=[],
                op="feed_cache_get",
            )
            cache_hit = bool(cached_ids)

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
            await guarded(
                lambda: self._cache.replace(
                    user_id=user_id,
                    entries=[(p.id, p.created_at) for p in rows],
                ),
                default=None,
                op="feed_cache_replace",
            )
            _observe_cache_miss()

        # --- Celebrity read-merge (ALL pages, not just page 1) ---
        # Fan-out skips celebrity authors at write time, so we must
        # read-merge their recent posts on every page — otherwise
        # page 2+ of a celebrity-heavy feed silently loses them.
        # On page 1: merge fresh celebrity posts.
        # On page 2+: fetch celebrity posts older than cursor, so
        # pagination stays consistent.
        celebrity_ids = await self._celebrity_authors(following_set=following_set)
        if celebrity_ids:
            celeb_posts = await self._repo.celebrity_following_posts(
                user_id=user_id,
                celebrity_ids=list(celebrity_ids),
                limit=lmt + 1,
                # Repository filters created_at < cts when provided
                before_ts=cts,
            )
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
            visible.sort(key=lambda p: (p.created_at, p.id), reverse=True)

        # Cursor filter for page 2+ (also filters merged celebrity posts)
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
        await guarded(
            lambda: self._cache.invalidate_many(user_ids=[*followers, author_id]),
            default=None,
            op="feed_cache_invalidate_new_post",
        )
        logger.info(
            "feed_invalidated_new_post",
            author_id=author_id,
            followers_count=len(followers),
        )

    async def invalidate_for_follow_change(self, *, follower_id: int) -> None:
        await guarded(
            lambda: self._cache.invalidate(user_id=follower_id),
            default=None,
            op="feed_cache_invalidate_follow",
        )

    async def invalidate_for_block(self, *, a_id: int, b_id: int) -> None:
        await guarded(
            lambda: self._cache.invalidate_many(user_ids=[a_id, b_id]),
            default=None,
            op="feed_cache_invalidate_block",
        )

    async def invalidate_for_mute(self, *, muter_id: int) -> None:
        await guarded(
            lambda: self._cache.invalidate(user_id=muter_id),
            default=None,
            op="feed_cache_invalidate_mute",
        )

    async def explore(
        self,
        *,
        viewer_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> ExploreFeedPage:
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

        cache_hit = False
        ordered_ids: list[int] = []

        # Try ZSET (page 1 only)
        if cts is None:
            has_entries = await guarded(
                lambda: self._cache.explore_has_entries(),
                default=False,
                op="explore_cache_exists",
            )
            if has_entries:
                empty_entries: list[tuple[int, float]] = []
                entries: list[tuple[int, float]] = await guarded(
                    lambda: self._cache.get_explore_ids(limit=lmt * 3),
                    default=empty_entries,
                    op="explore_cache_get",
                )
                ordered_ids = [pid for pid, _score in entries]
                if ordered_ids:
                    cache_hit = True
                    _observe_cache_hit_explore()

        if not ordered_ids:
            # Cold-start fallback: query DB directly.
            # TODO(M21): replace magic 48h with a settings value and
            # pass a datetime, not a float epoch.
            _observe_cache_miss_explore()
            recent = await self._repo.trending_source_posts(
                created_after_epoch=(datetime.now(UTC).timestamp() - 48 * 3600),
                limit=lmt * 3,
            )
            ordered_ids = [p.id for p in recent]
            cache_hit = False

        # Hydrate (preserves order)
        rows = await self._repo.fetch_posts_by_ids(post_ids=ordered_ids)

        if not rows:
            page_items: list[Post] = []
        else:
            author_ids = list({p.author_id for p in rows})
            blocked = await self._repo.blocked_with_author_ids(
                viewer_id=viewer_id, author_ids=author_ids
            )

            filtered = [
                p for p in rows if p.visibility == Visibility.PUBLIC and p.author_id not in blocked
            ]

            # Cursor filter (page 2+)
            # TODO(M21): verify tz-aware vs tz-naive alignment between
            # decode_cursor output and DB-returned created_at.
            if cts is not None and cid is not None:
                filtered = [p for p in filtered if (p.created_at, p.id) < (cts, cid)]

            page_items = filtered[:lmt]

        next_cursor: str | None = None
        if len(page_items) == lmt and len(ordered_ids) > lmt:
            last = page_items[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        post_ids_page = [p.id for p in page_items]
        liked_ids = await self._likes.exists_batch(
            user_id=viewer_id, target_type="post", target_ids=post_ids_page
        )

        elapsed = time.perf_counter() - started
        _observe_explore_generation(elapsed)

        return ExploreFeedPage(
            items=[_to_view(p, is_liked=p.id in liked_ids) for p in page_items],
            next_cursor=next_cursor,
            cache_hit=cache_hit,
        )
