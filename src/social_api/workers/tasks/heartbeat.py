"""Heartbeat task: emit queue depth + DB pool stats to Prometheus.

Never fails. Redis / DB / Prometheus failures are logged and swallowed;
the Beat schedule must keep firing so we don't lose the heartbeat signal
exactly when it matters most (an outage).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import Any, cast

from social_api.logging_config import get_logger
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)


async def _emit() -> dict[str, int]:
    emitted = {"queue_depth": 0, "db_checkedout": 0, "db_overflow": 0}

    # ---- Queue depth: Redis LLEN on the broker queue --------------------
    try:
        from social_api.cache.redis import get_redis

        redis = get_redis()

        # redis-py stubs unify sync and async signatures for shared
        # method names, so `.llen()` is typed `int | Awaitable[int]`.
        # The async client always returns an awaitable at runtime — cast
        # narrows the type without runtime cost.
        llen_val = cast(Awaitable[int], redis.llen("celery"))
        depth = int(await llen_val)

        try:
            from social_api.observability.metrics import celery_queue_depth

            celery_queue_depth.set(depth)
            emitted["queue_depth"] = depth
        except Exception as exc:  # pragma: no cover — metrics optional
            logger.debug(
                "metric_observe_failed",
                metric="celery_queue_depth",
                error=type(exc).__name__,
            )
    except Exception as exc:  # pragma: no cover — Redis optional
        # Redis outage: the heartbeat keeps firing so Prometheus still
        # receives the *other* signals (db_pool_*) and the alert rule for
        # celery_queue_depth going stale fires as intended.
        logger.warning("queue_depth_failed", error=type(exc).__name__)

    # ---- DB pool stats --------------------------------------------------
    try:
        from sqlalchemy.pool import AsyncAdaptedQueuePool

        from social_api.db.session import get_engine

        engine = get_engine()
        pool = engine.pool

        # AsyncEngine.pool is typed as the abstract `Pool`. The MySQL async
        # driver uses AsyncAdaptedQueuePool, which carries the meaningful
        # checkedout()/overflow() counters. isinstance narrows the type for
        # Pylance/mypy and is a correct runtime guard for NullPool (tests)
        # and StaticPool (in-memory SQLite) — those return 0/0.
        if isinstance(pool, AsyncAdaptedQueuePool):
            checkedout = int(pool.checkedout())
            overflow = int(pool.overflow())
        else:
            checkedout = 0
            overflow = 0

        try:
            from social_api.observability.metrics import (
                db_pool_checkedout,
                db_pool_overflow,
            )

            db_pool_checkedout.set(checkedout)
            db_pool_overflow.set(overflow)
            emitted["db_checkedout"] = checkedout
            emitted["db_overflow"] = overflow
        except Exception as exc:  # pragma: no cover — metrics optional
            logger.debug(
                "metric_observe_failed",
                metric="db_pool_stats",
                error=type(exc).__name__,
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("db_pool_stats_failed", error=type(exc).__name__)

    logger.info(
        "heartbeat_emitted",
        queue_depth=emitted["queue_depth"],
        db_checkedout=emitted["db_checkedout"],
        db_overflow=emitted["db_overflow"],
    )
    return emitted


@celery_app.task(name="metrics.emit_queue_depth", bind=True)
def emit_queue_depth(self: Any) -> dict[str, int]:
    """Celery Beat heartbeat: emit queue depth + DB pool stats.

    bind=True so `self` (Task) is injected; without it, Celery calls the
    function with no args and raises TypeError on first Beat fire.
    """
    return asyncio.run(_emit())
