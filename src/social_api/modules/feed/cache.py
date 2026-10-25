"""Redis ZSET-backed feed cache."""

from __future__ import annotations

from datetime import datetime
from typing import Final

from redis.asyncio import Redis

from social_api.cache.keys import RedisKeys
from social_api.logging_config import get_logger

logger = get_logger(__name__)

# Cap per-user cached feed to newest 500 entries (bounds memory + rebuild cost).
FEED_CACHE_CAP: Final[int] = 500


class FeedCache:
    """Home-feed cache in Redis ZSET: member=post_id, score=created_at epoch."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def _key(self, user_id: int) -> str:
        return RedisKeys.feed_home(user_id)

    async def get_ids(self, *, user_id: int, limit: int) -> list[tuple[int, float]]:
        """
        Returns up to `limit` newest post_ids as (post_id, epoch_score) pairs,
        newest first. Empty list means cache miss.
        """
        key = self._key(user_id)
        raw: list[tuple[str, float]] = await self._redis.zrevrange(
            key, 0, limit - 1, withscores=True
        )
        return [(int(member), float(score)) for member, score in raw]

    async def has_entries(self, *, user_id: int) -> bool:
        return bool(await self._redis.zcard(self._key(user_id)))

    async def replace(self, *, user_id: int, entries: list[tuple[int, datetime]]) -> None:
        """
        Overwrite cache with `entries` (post_id, created_at).
        Trims to newest FEED_CACHE_CAP.
        """
        key = self._key(user_id)
        if not entries:
            await self._redis.delete(key)
            return

        entries_sorted = sorted(entries, key=lambda e: e[1], reverse=True)
        entries_sorted = entries_sorted[:FEED_CACHE_CAP]

        pipe = self._redis.pipeline()
        pipe.delete(key)
        mapping: dict[str, float] = {str(pid): dt.timestamp() for pid, dt in entries_sorted}
        pipe.zadd(key, mapping)
        pipe.expire(key, 60 * 60 * 6)  # 6h TTL as safety net
        await pipe.execute()

    async def append(self, *, user_id: int, post_id: int, created_at: datetime) -> None:
        """Add one post_id (used by write-fanout in M10). Trims oldest."""
        key = self._key(user_id)
        pipe = self._redis.pipeline()
        pipe.zadd(key, {str(post_id): created_at.timestamp()})
        pipe.zremrangebyrank(key, 0, -(FEED_CACHE_CAP + 1))  # keep newest N
        pipe.expire(key, 60 * 60 * 6)
        await pipe.execute()

    async def invalidate(self, *, user_id: int) -> None:
        await self._redis.delete(self._key(user_id))

    async def invalidate_many(self, *, user_ids: list[int]) -> None:
        if not user_ids:
            return
        keys = [self._key(uid) for uid in user_ids]
        await self._redis.delete(*keys)

        # ---- Explore (shared global ZSET) ----

    async def get_explore_ids(self, *, limit: int) -> list[tuple[int, float]]:
        """Top `limit` post ids from shared explore ZSET, highest score first."""
        raw: list[tuple[str, float]] = await self._redis.zrevrange(
            "feed:explore", 0, limit - 1, withscores=True
        )
        return [(int(member), float(score)) for member, score in raw]

    async def explore_has_entries(self) -> bool:
        return bool(await self._redis.zcard("feed:explore"))
