"""Feed fan-out Celery tasks.

Two tasks:
  1. fanout_new_post: push a new post into every follower's ZSET cache.
     Skipped for celebrity authors (>= FEED_FANOUT_THRESHOLD followers).
  2. backfill_follow_on_follow: when a new follow is created, insert the
     followee's recent posts into the follower's ZSET.

Both are idempotent (ZADD with same member+score is a no-op).
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, cast

from redis.asyncio import Redis

from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.core.tracing_helpers import span
from social_api.logging_config import get_logger
from social_api.modules.feed.cache import FEED_CACHE_CAP, FeedCache
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)

_FEED_TTL_SECONDS = 60 * 60 * 6
_CHUNK = 500


# ---------------------------------------------------------------------------
# Async implementation (testable in isolation)
# ---------------------------------------------------------------------------
async def _do_fanout(
    *,
    post_id: int,
    author_id: int,
    created_at_iso: str,
    follower_ids: list[int],
    redis: Redis,
) -> int:
    """Push post_id into each follower's ZSET. Returns count written.

    Idempotent: ZADD with same (member, score) is a no-op, and the trim
    below removes anything beyond FEED_CACHE_CAP. Safe to retry.
    """
    created_at = datetime.fromisoformat(created_at_iso)
    score = created_at.timestamp()
    cache = FeedCache(redis)

    written = 0
    # transaction=True (default) uses MULTI/EXEC, preserving the
    # zadd → zremrangebyrank → expire ordering per key. Do NOT set
    # transaction=False — reordering would trim the wrong entry.
    pipe = redis.pipeline(transaction=True)
    for i in range(0, len(follower_ids), _CHUNK):
        batch = follower_ids[i : i + _CHUNK]
        for fid in batch:
            key = f"feed:home:{fid}"
            pipe.zadd(key, {str(post_id): score})
            pipe.zremrangebyrank(key, 0, -(FEED_CACHE_CAP + 1))
            pipe.expire(key, _FEED_TTL_SECONDS)
        # execute() raises on any Redis error — written only advances on success.
        await pipe.execute()
        written += len(batch)

    # Also push to the author's own feed.
    await cache.append(user_id=author_id, post_id=post_id, created_at=created_at)
    return written


async def _do_backfill(
    *,
    follower_id: int,
    followee_id: int,
    post_ids: list[int],
    created_ats: list[datetime],
    redis: Redis,
) -> int:
    if not post_ids:
        return 0
    key = f"feed:home:{follower_id}"
    mapping = {str(pid): dt.timestamp() for pid, dt in zip(post_ids, created_ats, strict=True)}
    pipe = redis.pipeline(transaction=True)
    pipe.zadd(key, mapping)
    pipe.zremrangebyrank(key, 0, -(FEED_CACHE_CAP + 1))
    pipe.expire(key, _FEED_TTL_SECONDS)
    await pipe.execute()
    return len(post_ids)


# ---------------------------------------------------------------------------
# Celery tasks (sync wrappers)
# ---------------------------------------------------------------------------
@celery_app.task(
    name="feed.fanout_new_post",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_backoff_max=60,
    retry_kwargs={"max_retries": 3},
)
def fanout_new_post(
    self: Any,
    post_id: int,
    author_id: int,
    created_at_iso: str,
    follower_ids: list[int],
) -> dict[str, int]:
    """Push a new post into every follower's ZSET.

    Called from PostsService.create when author is below the celebrity
    threshold. `follower_ids` is resolved by the caller (main process) to
    avoid a second DB round-trip in the worker.
    """

    async def _run() -> int:
        redis = get_redis()
        with span(
            "fanout.new_post",
            {"post_id": post_id, "follower_count": len(follower_ids)},
        ):
            return await _do_fanout(
                post_id=post_id,
                author_id=author_id,
                created_at_iso=created_at_iso,
                follower_ids=follower_ids,
                redis=redis,
            )

    written = asyncio.run(_run())
    logger.info(
        "fanout_done",
        post_id=post_id,
        author_id=author_id,
        followers=written,
    )
    return {"post_id": post_id, "written": written}


@celery_app.task(
    name="feed.backfill_follow",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_backoff_max=60,
    retry_kwargs={"max_retries": 3},
)
def backfill_follow_on_follow(
    self: Any,
    follower_id: int,
    followee_id: int,
    post_ids: list[int],
    created_at_isos: list[str],
) -> dict[str, int]:
    """Backfill followee's recent posts into the follower's cache."""

    async def _run() -> int:
        redis = get_redis()
        with span(
            "fanout.backfill",
            {
                "follower_id": follower_id,
                "followee_id": followee_id,
                "post_count": len(post_ids),
            },
        ):
            return await _do_backfill(
                follower_id=follower_id,
                followee_id=followee_id,
                post_ids=post_ids,
                created_ats=[datetime.fromisoformat(s) for s in created_at_isos],
                redis=redis,
            )

    written = asyncio.run(_run())
    logger.info(
        "backfill_done",
        follower_id=follower_id,
        followee_id=followee_id,
        posts=written,
    )
    return {"follower_id": follower_id, "written": written}


# ---------------------------------------------------------------------------
# Helper used by callers to decide whether to schedule fan-out
# ---------------------------------------------------------------------------
def is_celebrity(follower_count: int) -> bool:
    settings = get_settings()
    return follower_count >= settings.feed_fanout_threshold


# ---------------------------------------------------------------------------
# Typed wrappers — the public API that business code calls
# ---------------------------------------------------------------------------
def enqueue_fanout(
    *,
    post_id: int,
    author_id: int,
    created_at_iso: str,
    follower_ids: list[int],
) -> None:
    """Type-safe enqueue for fanout_new_post.

    Wraps `.delay()` so mypy/pylance see a concrete function, not a Celery
    `FunctionType`. If we ever swap Celery for another queue, only this
    wrapper changes.
    """
    cast(Any, fanout_new_post).delay(
        post_id=post_id,
        author_id=author_id,
        created_at_iso=created_at_iso,
        follower_ids=follower_ids,
    )


def enqueue_backfill(
    *,
    follower_id: int,
    followee_id: int,
    post_ids: list[int],
    created_at_isos: list[str],
) -> None:
    """Type-safe enqueue for backfill_follow_on_follow."""
    cast(Any, backfill_follow_on_follow).delay(
        follower_id=follower_id,
        followee_id=followee_id,
        post_ids=post_ids,
        created_at_isos=created_at_isos,
    )
