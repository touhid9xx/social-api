"""Moderation service."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import User
from social_api.modules.auth.repository import UserRepository
from social_api.modules.chat.repository import ChatRepository
from social_api.modules.comments.repository import CommentsRepository
from social_api.modules.moderation.exceptions import (
    CannotReportSelfError,
    ReportAlreadyExistsError,
    ReportLockedError,
    ReportNotFoundError,
    ReportTargetNotFoundError,
)
from social_api.modules.moderation.models import (
    TERMINAL_STATUSES,
    Report,
    ReportStatus,
    ReportTargetType,
)
from social_api.modules.moderation.repository import ReportsRepository
from social_api.modules.moderation.schemas import (
    ReportCreate,
    ReportPage,
    ReportUpdate,
    ReportView,
)
from social_api.modules.posts.repository import PostsRepository

logger = get_logger(__name__)


def _to_view(r: Report) -> ReportView:
    return ReportView(
        id=r.id,
        reporter_id=r.reporter_id,
        target_type=r.target_type.value,
        target_id=r.target_id,
        reason=r.reason.value,
        details=r.details,
        status=r.status.value,
        reviewer_id=r.reviewer_id,
        resolution_note=r.resolution_note,
        resolved_at=r.resolved_at,
        created_at=r.created_at,
        updated_at=r.updated_at,
        version=r.version,
    )


class ModerationService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = ReportsRepository(session)
        self._users = UserRepository(session)
        self._posts = PostsRepository(session)
        self._comments = CommentsRepository(session)
        self._chat = ChatRepository(session)

    async def _resolve_target_author(
        self, *, target_type: ReportTargetType, target_id: int
    ) -> int | None:
        """Return the target's author_id, or None if target doesn't exist."""
        if target_type == ReportTargetType.POST:
            p = await self._posts.get_by_id(target_id)
            return p.author_id if p is not None else None
        if target_type == ReportTargetType.COMMENT:
            c = await self._comments.get_by_id(target_id)
            return c.author_id if c is not None else None
        if target_type == ReportTargetType.USER:
            u = await self._users.get_by_id(target_id)
            return u.id if u is not None else None
        if target_type == ReportTargetType.MESSAGE:
            m = await self._chat.get_message(target_id)
            return m.sender_id if m is not None else None
        # Fallback for any future enum value not covered above — defensive.
        raise NotImplementedError(f"Unhandled ReportTargetType: {target_type!r}")

    async def create_report(self, *, reporter_id: int, payload: ReportCreate) -> ReportView:
        target_type = ReportTargetType(payload.target_type)

        author_id = await self._resolve_target_author(
            target_type=target_type, target_id=payload.target_id
        )
        if author_id is None:
            raise ReportTargetNotFoundError()
        if author_id == reporter_id:
            raise CannotReportSelfError()

        row = await self._repo.create(
            reporter_id=reporter_id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            reason=payload.reason,
            details=payload.details,
        )
        # Repo returns None on unique dedupe hit; matches
        # ReportAlreadyExistsError.
        if row is None:
            raise ReportAlreadyExistsError()

        logger.info(
            "report_created",
            report_id=row.id,
            reporter_id=reporter_id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            reason=payload.reason,
        )
        return _to_view(row)

    async def list_reports(
        self,
        *,
        status_filter: ReportStatus | None,
        cursor: str | None,
        limit: int | None,
    ) -> ReportPage:
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError(
                    "Invalid cursor",
                    detail={"code": "INVALID_CURSOR"},
                ) from None

        rows = await self._repo.list_reports(
            status_filter=status_filter,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        return ReportPage(
            items=[_to_view(r) for r in rows],
            next_cursor=next_cursor,
        )

    async def update_report(
        self,
        *,
        reviewer: User,
        report_id: int,
        payload: ReportUpdate,
    ) -> ReportView:
        row = await self._repo.get_by_id(report_id)
        if row is None:
            raise ReportNotFoundError()

        # Optimistic lock
        if row.version != payload.version:
            from social_api.modules.users.exceptions import (
                OptimisticLockError,
            )

            raise OptimisticLockError(
                detail={
                    "current_version": row.version,
                    "current": _to_view(row).model_dump(mode="json"),
                }
            )

        new_status = ReportStatus(payload.status)

        # Terminal-state rules: once resolved/dismissed, only "same state"
        # is a success (idempotent); any other status is locked.
        if row.status in TERMINAL_STATUSES:
            if new_status == row.status:
                return _to_view(row)
            raise ReportLockedError()

        # Non-terminal -> same status: idempotent no-op.
        if row.status == new_status:
            return _to_view(row)

        # ---- Capture before-state for the audit diff ----
        old_status = row.status
        old_reviewer_id = row.reviewer_id
        old_note = row.resolution_note

        # Apply transition
        row.status = new_status
        row.reviewer_id = reviewer.id
        row.resolution_note = payload.resolution_note
        if new_status in TERMINAL_STATUSES:
            row.resolved_at = datetime.now(UTC).replace(tzinfo=None)
        row.version += 1
        await self._repo.save(row)

        # ---- Audit: status transition on a moderation report ----
        # Reviewer just made a decision affecting a user's content /
        # account — state-changing staff action. Both self-contained
        # (before/after) so forensics can reconstruct the decision
        # without joining other tables.
        await AuditService(self._s).write(
            actor_id=reviewer.id,
            action="MODERATION_STATUS_UPDATE",
            entity="report",
            entity_id=row.id,
            before={
                "status": old_status.value,
                "reviewer_id": old_reviewer_id,
                "resolution_note": old_note,
            },
            after={
                "status": row.status.value,
                "reviewer_id": row.reviewer_id,
                "resolution_note": row.resolution_note,
            },
        )

        logger.info(
            "report_updated",
            report_id=row.id,
            reviewer_id=reviewer.id,
            new_status=new_status.value,
        )

        if new_status in TERMINAL_STATUSES:
            await self._notify_reporter(row)

        return _to_view(row)

    async def _notify_reporter(self, report: Report) -> None:
        """Best-effort WS push to the reporter."""
        try:
            from social_api.core.feature_flags import get_flags

            if not get_flags().is_enabled("ws_enabled"):
                return

            from social_api.cache.redis import get_redis
            from social_api.realtime.channels import publish_to_user
            from social_api.realtime.events import build_event

            redis = get_redis()
            payload = build_event(
                type_="notification",
                data={
                    "kind": "report_resolved",
                    "report_id": report.id,
                    "status": report.status.value,
                    "target_type": report.target_type.value,
                    "target_id": report.target_id,
                },
            )
            await publish_to_user(
                redis=redis,
                user_id=report.reporter_id,
                payload=payload,
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "report_notify_failed",
                report_id=report.id,
                error=type(exc).__name__,
            )
