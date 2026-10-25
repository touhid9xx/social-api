"""Trending / explore feed refresh task.

Runs on Celery Beat every 5 minutes:
  - Pull recent PUBLIC posts from DB
  - Score by HN-style gravity
  - Write to Redis ZSET `feed:explore`
  - Trim to top 2000, set TTL 600s
"""

from __future__ import annotations

import asyncio
import math
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis

from social_api.cache.redis import get_redis
from social_api.db.session import get_sessionmaker
from social_api.logging_config import get_logger
from social_api.modules.feed.repository import FeedRepository
from social_api.modules.users.models import Visibility
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)

EXPLORE_ZSET_KEY = "feed:explore"
EXPLORE_MAX_ENTRIES = 2000
EXPLORE_TTL_SECONDS = 600
EXPLORE_WINDOW_HOURS = 48
EXPLORE_SOURCE_LIMIT = 5000

# HN-style gravity
GRAVITY = 1.5
AGE_OFFSET_HOURS = 2.0
LIKE_WEIGHT = 2.0
COMMENT_WEIGHT = 3.0


def compute_trending_score(
    *,
    like_count: int,
    comment_count: int,
    created_at: datetime,
    now: datetime,
) -> float:
    """HN-style gravity score. Higher = hotter."""
    age_hours = max(0.0, (now - created_at).total_seconds() / 3600.0)
    engagement = like_count * LIKE_WEIGHT + comment_count * COMMENT_WEIGHT
    # math.pow is typed (float, float) -> float; builtins.pow returns Any
    # under mypy strict for the float/float overload.
    return engagement / math.pow(age_hours + AGE_OFFSET_HOURS, GRAVITY)


async def _refresh(redis: Redis) -> int:
    """Pull recent public posts, score, write to Redis. Returns count."""
    now = datetime.now(UTC)
    cutoff = now.timestamp() - EXPLORE_WINDOW_HOURS * 3600

    sm = get_sessionmaker()
    async with sm() as session:
        repo = FeedRepository(session)

        # Fetch recent public posts (pre-score filter, cheap on DB with index)
        posts = await repo.trending_source_posts(
            created_after_epoch=cutoff,
            limit=EXPLORE_SOURCE_LIMIT,
        )

        if not posts:
            logger.info("trending_refresh_empty")
            return 0

        # Score
        scored: list[tuple[int, float]] = [
            (
                p.id,
                compute_trending_score(
                    like_count=p.like_count,
                    comment_count=p.comment_count,
                    created_at=p.created_at.replace(tzinfo=UTC),
                    now=now,
                ),
            )
            for p in posts
            if p.visibility == Visibility.PUBLIC
        ]

        if not scored:
            logger.info("trending_refresh_no_public")
            return 0

        # Write to Redis
        pipe = redis.pipeline()
        pipe.delete(EXPLORE_ZSET_KEY)
        mapping = {str(pid): score for pid, score in scored}
        pipe.zadd(EXPLORE_ZSET_KEY, mapping)
        pipe.zremrangebyrank(EXPLORE_ZSET_KEY, 0, -(EXPLORE_MAX_ENTRIES + 1))
        pipe.expire(EXPLORE_ZSET_KEY, EXPLORE_TTL_SECONDS)
        await pipe.execute()

    logger.info(
        "trending_refresh_done",
        source_count=len(posts),
        scored_count=len(scored),
        written=min(len(scored), EXPLORE_MAX_ENTRIES),
    )
    return len(scored)


@celery_app.task(
    name="feed.refresh_explore_zset",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=10,
    retry_backoff_max=120,
    retry_kwargs={"max_retries": 2},
)
def refresh_explore_zset(self: Any) -> dict[str, int]:
    """Celery Beat task: refresh the explore ZSET."""

    async def _run() -> int:
        redis = get_redis()
        return await _refresh(redis)

    try:
        count = asyncio.run(_run())
        return {"scored": count}
    except Exception as exc:
        logger.error("trending_refresh_failed", error=type(exc).__name__)
        raise
