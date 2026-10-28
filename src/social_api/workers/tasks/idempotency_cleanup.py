"""Idempotency key cleanup task."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from social_api.db.session import get_sessionmaker
from social_api.logging_config import get_logger
from social_api.modules.idempotency.repository import IdempotencyRepository
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)

_BATCH = 1000
_MAX_ITERATIONS = 100  # 100K rows per run


async def _do_cleanup() -> dict[str, int]:
    now = datetime.now(UTC).replace(tzinfo=None)
    total = 0
    sm = get_sessionmaker()
    async with sm() as session:
        repo = IdempotencyRepository(session)
        for _ in range(_MAX_ITERATIONS):
            n = await repo.delete_expired(before=now, limit=_BATCH)
            await session.commit()
            total += n
            if n < _BATCH:
                break
    if total:
        logger.info("idempotency_cleanup_done", deleted=total)
    return {"deleted": total}


@celery_app.task(name="idempotency.cleanup")
def cleanup_idempotency(self: Any) -> dict[str, int]:
    return asyncio.run(_do_cleanup())
