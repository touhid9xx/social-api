"""Idempotency service."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.config import get_settings
from social_api.logging_config import get_logger
from social_api.modules.idempotency.exceptions import (
    IdempotencyConflictError,
    IdempotencyInProgressError,
)
from social_api.modules.idempotency.repository import IdempotencyRepository

logger = get_logger(__name__)


def hash_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


class IdempotencyService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = IdempotencyRepository(session)
        self._s = session

    async def check_or_reserve(
        self,
        *,
        key: str,
        user_id: int,
        endpoint: str,
        method: str,
        request_hash: str,
    ) -> tuple[str, dict[str, object] | None, int | None]:
        settings = get_settings()
        ttl = settings.idempotency_ttl_seconds
        now = datetime.now(UTC).replace(tzinfo=None)

        existing = await self._repo.get(key=key, user_id=user_id)
        if existing is not None:
            if existing.expires_at > now:
                if existing.request_hash != request_hash:
                    return ("conflict", None, None)
                if existing.response_status is None:
                    return ("in_progress", None, None)
                return (
                    "hit",
                    existing.response_body,
                    existing.response_status,
                )
            # Expired — clean up so insert can succeed
            await self._repo.delete_by_id(existing.id)

        row = await self._repo.try_insert(
            key=key,
            user_id=user_id,
            endpoint=endpoint,
            method=method,
            request_hash=request_hash,
            expires_at=now + timedelta(seconds=ttl),
        )
        if row is None:
            return ("in_progress", None, None)

        return ("miss", None, None)

    async def record_response(
        self,
        *,
        key: str,
        user_id: int,
        status: int,
        body: dict[str, object] | None,
    ) -> None:
        existing = await self._repo.get(key=key, user_id=user_id)
        if existing is None:
            return
        await self._repo.complete(row_id=existing.id, status=status, body=body)


def raise_if_blocked(state: str) -> None:
    if state == "conflict":
        raise IdempotencyConflictError()
    if state == "in_progress":
        raise IdempotencyInProgressError()
