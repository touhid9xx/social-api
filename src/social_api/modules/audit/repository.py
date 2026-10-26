"""Audit repository."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.audit.models import AuditLog


class AuditRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def create(
        self,
        *,
        actor_id: int | None,
        action: str,
        entity: str,
        entity_id: int | None,
        before: dict[str, Any] | None,
        after: dict[str, Any] | None,
        ip: str | None,
        user_agent: str | None,
        request_id: str | None,
    ) -> AuditLog:
        row = AuditLog(
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            before=before,
            after=after,
            ip=ip,
            user_agent=(user_agent or "")[:256] or None,
            request_id=request_id,
        )
        self._s.add(row)
        await self._s.flush()
        await self._s.refresh(row)
        return row

    async def list_logs(
        self,
        *,
        actor_id: int | None,
        action_filter: str | None,
        entity_filter: str | None,
        entity_id_filter: int | None,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[AuditLog]:
        stmt = select(AuditLog).where(AuditLog.deleted_at.is_(None))
        if actor_id is not None:
            stmt = stmt.where(AuditLog.actor_id == actor_id)
        if action_filter:
            stmt = stmt.where(AuditLog.action == action_filter)
        if entity_filter:
            stmt = stmt.where(AuditLog.entity == entity_filter)
        if entity_id_filter is not None:
            stmt = stmt.where(AuditLog.entity_id == entity_id_filter)
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    AuditLog.created_at < cursor_ts,
                    and_(
                        AuditLog.created_at == cursor_ts,
                        AuditLog.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())
