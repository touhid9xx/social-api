"""Moderation service: report creation, dedupe, transitions."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest

from social_api.modules.auth.models import User, UserRole
from social_api.modules.moderation.exceptions import (
    CannotReportSelfError,
    ReportAlreadyExistsError,
    ReportLockedError,
    ReportTargetNotFoundError,
)
from social_api.modules.moderation.models import (
    Report,
    ReportReason,
    ReportStatus,
    ReportTargetType,
)
from social_api.modules.moderation.schemas import ReportCreate, ReportUpdate
from social_api.modules.moderation.service import ModerationService

pytestmark = pytest.mark.unit


class _FakeReportsRepo:
    def __init__(self) -> None:
        self._seen: dict[tuple[int, str, int, date], Report] = {}
        self._by_id: dict[int, Report] = {}
        self._next_id = 1

    async def create(
        self,
        *,
        reporter_id: int,
        target_type: str,
        target_id: int,
        reason: str,
        details: str | None,
    ) -> Report | None:
        now = datetime.now(UTC).replace(tzinfo=None)
        key = (reporter_id, target_type, target_id, now.date())
        if key in self._seen:
            return None
        row = Report(
            id=self._next_id,
            reporter_id=reporter_id,
            target_type=ReportTargetType(target_type),
            target_id=target_id,
            reason=ReportReason(reason),
            details=details,
            status=ReportStatus.OPEN,
            reviewer_id=None,
            resolution_note=None,
            resolved_at=None,
            day_bucket=now.date(),
            created_at=now,
            updated_at=now,
            deleted_at=None,
            version=1,
        )
        self._next_id += 1
        self._seen[key] = row
        self._by_id[row.id] = row
        return row

    async def get_by_id(self, report_id: int) -> Report | None:
        return self._by_id.get(report_id)

    async def save(self, r: Report) -> None:
        pass


class _FakePostsRepo:
    def __init__(self, authors: dict[int, int] | None = None) -> None:
        self._authors = authors or {}

    async def get_by_id(self, post_id: int) -> Any:
        if post_id in self._authors:
            return type("P", (), {"author_id": self._authors[post_id]})()
        return None


class _FakeUsersRepo:
    def __init__(self, exists: set[int] | None = None) -> None:
        self._exists = exists or set()

    async def get_by_id(self, uid: int) -> Any:
        return object() if uid in self._exists else None


class _FakeCommentsRepo:
    async def get_by_id(self, cid: int) -> Any:
        return None


class _FakeChatRepo:
    async def get_message(self, mid: int) -> Any:
        return None


def _svc(
    *,
    authors: dict[int, int] | None = None,
    users: set[int] | None = None,
) -> ModerationService:
    svc = ModerationService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeReportsRepo()  # type: ignore[assignment]
    svc._posts = _FakePostsRepo(authors)  # type: ignore[assignment]
    svc._users = _FakeUsersRepo(users)  # type: ignore[assignment]
    svc._comments = _FakeCommentsRepo()  # type: ignore[assignment]
    svc._chat = _FakeChatRepo()  # type: ignore[assignment]
    return svc


def _moderator(uid: int = 99) -> User:
    u = User(
        id=uid,
        email="m@example.com",
        email_hash="h",
        password_hash="x",
        role=UserRole.MODERATOR,
        is_active=True,
        is_verified=False,
    )
    u.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    return u


@pytest.mark.asyncio
async def test_create_report_ok() -> None:
    svc = _svc(authors={100: 5})  # post 100 authored by 5
    out = await svc.create_report(
        reporter_id=10,
        payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
    )
    assert out.status == "open"
    assert out.target_id == 100


@pytest.mark.asyncio
async def test_self_report_blocked() -> None:
    svc = _svc(authors={100: 10})
    with pytest.raises(CannotReportSelfError):
        await svc.create_report(
            reporter_id=10,
            payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
        )


@pytest.mark.asyncio
async def test_target_missing() -> None:
    svc = _svc(authors={})
    with pytest.raises(ReportTargetNotFoundError):
        await svc.create_report(
            reporter_id=10,
            payload=ReportCreate(target_type="post", target_id=999, reason="spam"),
        )


@pytest.mark.asyncio
async def test_duplicate_same_day() -> None:
    svc = _svc(authors={100: 5})
    await svc.create_report(
        reporter_id=10,
        payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
    )
    with pytest.raises(ReportAlreadyExistsError):
        await svc.create_report(
            reporter_id=10,
            payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
        )


@pytest.mark.asyncio
async def test_transition_open_to_resolved() -> None:
    svc = _svc(authors={100: 5})
    r = await svc.create_report(
        reporter_id=10,
        payload=ReportCreate(target_type="post", target_id=100, reason="abuse"),
    )
    out = await svc.update_report(
        reviewer=_moderator(),
        report_id=r.id,
        payload=ReportUpdate(status="resolved", version=1),
    )
    assert out.status == "resolved"
    assert out.resolved_at is not None


@pytest.mark.asyncio
async def test_transition_terminal_same_status_idempotent() -> None:
    svc = _svc(authors={100: 5})
    r = await svc.create_report(
        reporter_id=10,
        payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
    )
    _ = await svc.update_report(
        reviewer=_moderator(),
        report_id=r.id,
        payload=ReportUpdate(status="dismissed", version=1),
    )
    # Same status again -> no-op (no version conflict on same status)
    out = await svc.update_report(
        reviewer=_moderator(),
        report_id=r.id,
        payload=ReportUpdate(status="dismissed", version=2),
    )
    assert out.status == "dismissed"


@pytest.mark.asyncio
async def test_transition_terminal_different_status_rejected() -> None:
    svc = _svc(authors={100: 5})
    r = await svc.create_report(
        reporter_id=10,
        payload=ReportCreate(target_type="post", target_id=100, reason="spam"),
    )
    _ = await svc.update_report(
        reviewer=_moderator(),
        report_id=r.id,
        payload=ReportUpdate(status="resolved", version=1),
    )
    with pytest.raises(ReportLockedError):
        await svc.update_report(
            reviewer=_moderator(),
            report_id=r.id,
            payload=ReportUpdate(status="dismissed", version=2),
        )
