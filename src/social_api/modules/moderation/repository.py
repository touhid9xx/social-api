"""Moderation repository."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.moderation.models import (
    Report,
    ReportReason,
    ReportStatus,
    ReportTargetType,
)


class ReportsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def create(
        self,
        *,
        reporter_id: int,
        target_type: str,
        target_id: int,
        reason: str,
        details: str | None,
    ) -> Report | None:
        """Idempotent per (reporter, target, day). Returns None on duplicate."""
        now = datetime.now(UTC).replace(tzinfo=None)
        row = Report(
            reporter_id=reporter_id,
            target_type=ReportTargetType(target_type),
            target_id=target_id,
            reason=ReportReason(reason),
            details=details,
            status=ReportStatus.OPEN,
            day_bucket=now.date(),
        )
        self._s.add(row)
        try:
            await self._s.flush()
            await self._s.refresh(row)
            return row
        except IntegrityError:
            await self._s.rollback()
            return None

    async def get_by_id(self, report_id: int) -> Report | None:
        stmt = select(Report).where(Report.id == report_id, Report.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def list_reports(
        self,
        *,
        status_filter: str | None,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Report]:
        stmt = select(Report).where(Report.deleted_at.is_(None))
        if status_filter is not None:
            stmt = stmt.where(Report.status == ReportStatus(status_filter))
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Report.created_at < cursor_ts,
                    and_(
                        Report.created_at == cursor_ts,
                        Report.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Report.created_at.desc(), Report.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def save(self, report: Report) -> None:
        await self._s.flush()
        await self._s.refresh(report)
