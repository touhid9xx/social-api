"""Idempotency repository."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.idempotency.models import IdempotencyKey


class IdempotencyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, *, key: str, user_id: int) -> IdempotencyKey | None:
        stmt = select(IdempotencyKey).where(
            IdempotencyKey.key == key,
            IdempotencyKey.user_id == user_id,
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def try_insert(
        self,
        *,
        key: str,
        user_id: int,
        endpoint: str,
        method: str,
        request_hash: str,
        expires_at: datetime,
    ) -> IdempotencyKey | None:
        """
        Insert a new in-progress row. Returns None on unique conflict
        (concurrent request with same key).
        """
        row = IdempotencyKey(
            key=key,
            user_id=user_id,
            endpoint=endpoint,
            method=method,
            request_hash=request_hash,
            expires_at=expires_at,
        )
        self._s.add(row)
        try:
            await self._s.flush()
            await self._s.refresh(row)
            return row
        except IntegrityError:
            await self._s.rollback()
            return None

    async def complete(
        self,
        *,
        row_id: int,
        status: int,
        body: dict[str, Any] | None,
    ) -> None:
        row = await self._s.get(IdempotencyKey, row_id)
        if row is None:
            return
        row.response_status = status
        row.response_body = body
        await self._s.flush()

    async def delete_expired(self, *, before: datetime, limit: int = 1000) -> int:
        # Batched: MySQL doesn't support LIMIT on DELETE without subquery.
        subq = select(IdempotencyKey.id).where(IdempotencyKey.expires_at < before).limit(limit)
        ids = [r[0] for r in (await self._s.execute(subq)).all()]
        if not ids:
            return 0
        await self._s.execute(delete(IdempotencyKey).where(IdempotencyKey.id.in_(ids)))
        return len(ids)

    async def delete_by_id(self, row_id: int) -> None:
        await self._s.execute(delete(IdempotencyKey).where(IdempotencyKey.id == row_id))
