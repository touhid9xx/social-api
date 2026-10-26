"""Notifications repository."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.helpers import execute_dml
from social_api.modules.notifications.models import (
    Notification,
    NotificationTargetType,
    NotificationType,
)


class NotificationsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def create(
        self,
        *,
        user_id: int,
        actor_id: int,
        type_: str,
        target_type: str,
        target_id: int,
        preview: str | None,
        now: datetime | None = None,
    ) -> Notification | None:
        """
        Idempotent create. Returns None if the (user,actor,type,target,day)
        tuple already exists (silent dedupe).
        """
        n = now or datetime.now(UTC).replace(tzinfo=None)
        row = Notification(
            user_id=user_id,
            actor_id=actor_id,
            type=NotificationType(type_),
            target_type=NotificationTargetType(target_type),
            target_id=target_id,
            preview=(preview or "")[:200] or None,
            is_read=False,
            day_bucket=n.date(),
        )
        self._s.add(row)
        try:
            await self._s.flush()
            await self._s.refresh(row)
            return row
        except IntegrityError:
            await self._s.rollback()
            return None

    async def get_by_id(self, notif_id: int) -> Notification | None:
        stmt = select(Notification).where(
            Notification.id == notif_id,
            Notification.deleted_at.is_(None),
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def list_for_user(
        self,
        *,
        user_id: int,
        unread_only: bool,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Notification]:
        stmt = select(Notification).where(
            Notification.user_id == user_id,
            Notification.deleted_at.is_(None),
        )
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Notification.created_at < cursor_ts,
                    and_(
                        Notification.created_at == cursor_ts,
                        Notification.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def unread_count(self, *, user_id: int) -> int:
        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read.is_(False),
                Notification.deleted_at.is_(None),
            )
        )
        res = await self._s.execute(stmt)
        return int(res.scalar_one())

    async def mark_read(self, *, user_id: int, notif_id: int) -> Notification | None:
        row = await self.get_by_id(notif_id)
        if row is None or row.user_id != user_id:
            return None
        if not row.is_read:
            row.is_read = True
            row.read_at = datetime.now(UTC).replace(tzinfo=None)
            await self._s.flush()
        return row

    async def mark_all_read(self, *, user_id: int) -> int:
        now = datetime.now(UTC).replace(tzinfo=None)
        stmt = (
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.is_read.is_(False),
                Notification.deleted_at.is_(None),
            )
            .values(is_read=True, read_at=now)
        )
        return await execute_dml(self._s, stmt)

    async def soft_delete(self, *, user_id: int, notif_id: int) -> bool:
        row = await self.get_by_id(notif_id)
        if row is None or row.user_id != user_id:
            return False
        row.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._s.flush()
        return True
