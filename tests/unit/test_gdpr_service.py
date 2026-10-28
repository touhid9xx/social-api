"""GDPR service unit tests: schedule/cancel/status (export covered in integration)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import MethodType
from typing import TYPE_CHECKING, ClassVar, cast

import pytest

from social_api.modules.auth.models import User, UserRole
from social_api.modules.gdpr.exceptions import (
    AlreadyScheduledForDeletionError,
    NoActiveDeletionError,
)
from social_api.modules.gdpr.models import (
    DeletionRequest,
    DeletionStatus,
)
from social_api.modules.gdpr.service import GdprService

if TYPE_CHECKING:
    MonkeyPatch = pytest.MonkeyPatch

pytestmark = pytest.mark.unit


def _user() -> User:
    u = User(
        id=42,
        email="alice@example.com",
        email_hash="h",
        password_hash="x",
        role=UserRole.USER,
        is_active=True,
        is_verified=False,
    )
    u.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    u.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    u.deleted_at = None
    return u


class _FakeDelRepo:
    def __init__(self) -> None:
        self.active: DeletionRequest | None = None
        self._next_id = 1

    async def get_active_for_user(self, user_id: int) -> DeletionRequest | None:
        return self.active

    async def create(self, *, user_id: int, scheduled_hard_delete_at: datetime) -> DeletionRequest:
        row = DeletionRequest(
            id=self._next_id,
            user_id=user_id,
            requested_at=datetime.now(UTC).replace(tzinfo=None),
            scheduled_hard_delete_at=scheduled_hard_delete_at,
            status=DeletionStatus.SCHEDULED,
            completed_at=None,
            cancelled_at=None,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            updated_at=datetime.now(UTC).replace(tzinfo=None),
            deleted_at=None,
            version=1,
        )
        self._next_id += 1
        self.active = row
        return row

    async def cancel(self, row: DeletionRequest) -> None:
        row.status = DeletionStatus.CANCELLED
        row.cancelled_at = datetime.now(UTC).replace(tzinfo=None)
        self.active = None


class _FakeProfile:
    def __init__(self) -> None:
        self.deleted_at: datetime | None = datetime(2026, 1, 5, tzinfo=UTC).replace(tzinfo=None)


class _FakeProfileRepo:
    def __init__(self, profile: _FakeProfile | None) -> None:
        self._profile = profile
        self.was_called = False

    async def get_by_user_id_including_deleted(self, _user_id: int) -> _FakeProfile | None:
        self.was_called = True
        return self._profile


class _FakeAudit:
    calls: ClassVar[list[dict[str, object]]] = []

    def __init__(self, _session: object) -> None:
        pass

    async def write(self, **kwargs: object) -> None:
        type(self).calls.append(kwargs)


class _FakeSession:
    async def flush(self) -> None:
        return None


def _svc(
    del_repo: _FakeDelRepo,
    monkeypatch: MonkeyPatch,
    *,
    user: User | None = None,
    profile: _FakeProfile | None = None,
) -> GdprService:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.calls = []
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    svc = GdprService(session=None)  # type: ignore[arg-type]
    svc._del = del_repo  # type: ignore[assignment]

    async def _get_user(_self: object, _user_id: int) -> User:
        if user is None:
            from social_api.modules.users.exceptions import (
                ProfileNotFoundError,
            )

            raise ProfileNotFoundError()
        return user

    svc._get_user_or_404 = MethodType(_get_user, svc)  # type: ignore[method-assign]

    svc._profiles = _FakeProfileRepo(profile)  # type: ignore[assignment]
    svc._s = _FakeSession()  # type: ignore[assignment]
    return svc


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_schedule_deletion(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    svc = _svc(repo, monkeypatch, user=u)

    row = await svc.schedule_deletion(user=u)

    assert row.status == DeletionStatus.SCHEDULED
    delta = row.scheduled_hard_delete_at - datetime.now(UTC).replace(tzinfo=None)
    assert timedelta(days=29) < delta < timedelta(days=31)


@pytest.mark.asyncio
async def test_schedule_twice_conflict(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    svc = _svc(repo, monkeypatch, user=u)

    await svc.schedule_deletion(user=u)
    with pytest.raises(AlreadyScheduledForDeletionError):
        await svc.schedule_deletion(user=u)


@pytest.mark.asyncio
async def test_cancel_deletion(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    profile = _FakeProfile()
    svc = _svc(repo, monkeypatch, user=u, profile=profile)

    await svc.schedule_deletion(user=u)
    u.deleted_at = datetime(2026, 1, 5, tzinfo=UTC).replace(tzinfo=None)

    await svc.cancel_deletion(user_id=u.id)
    assert cast("datetime | None", u.deleted_at) is None
    assert u.is_active is True
    profile_repo = cast(_FakeProfileRepo, svc._profiles)
    assert profile_repo.was_called is True
    assert profile.deleted_at is None


@pytest.mark.asyncio
async def test_cancel_no_active(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    svc = _svc(repo, monkeypatch, user=u)

    with pytest.raises(NoActiveDeletionError):
        await svc.cancel_deletion(user_id=u.id)


@pytest.mark.asyncio
async def test_deletion_status_none(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    svc = _svc(repo, monkeypatch, user=u)

    out = await svc.deletion_status(user_id=u.id)

    assert out.status == "none"
    assert out.scheduled is False
    assert out.scheduled_hard_delete_at is None


@pytest.mark.asyncio
async def test_deletion_status_scheduled(monkeypatch: MonkeyPatch) -> None:
    repo = _FakeDelRepo()
    u = _user()
    svc = _svc(repo, monkeypatch, user=u)

    await svc.schedule_deletion(user=u)
    out = await svc.deletion_status(user_id=u.id)

    assert out.status == "scheduled"
    assert out.scheduled is True
    assert out.scheduled_hard_delete_at is not None
