"""Integration tests: GDPR endpoints (export / schedule / cancel / status)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, ClassVar

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_sessionmaker
from social_api.modules.auth.models import User
from social_api.modules.gdpr.models import DeletionRequest, DeletionStatus
from social_api.modules.users.models import Profile
from tests.conftest import verification_token_for

if TYPE_CHECKING:
    MonkeyPatch = pytest.MonkeyPatch

pytestmark = pytest.mark.integration


class _FakeAudit:
    calls: ClassVar[list[dict[str, object]]] = []

    def __init__(self, _session: object) -> None:
        pass

    async def write(self, **kwargs: object) -> None:
        type(self).calls.append(kwargs)

    @classmethod
    def reset(cls) -> None:
        cls.calls = []


async def _register_and_login(client: AsyncClient) -> tuple[int, dict[str, str]]:
    email = f"gdpr-{datetime.now(UTC).timestamp()}@example.com"
    password = "CorrectHorseBattery9!"

    r = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password},
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    user_id = body.get("id") or body.get("user_id") or (body.get("user") or {}).get("id")
    assert isinstance(user_id, int), f"no user id in register response: {body}"

    # A fresh account is unverified and /auth/login answers 403 to it, so
    # consume the mailed link before signing in — the real user's path.
    r = await client.post(
        "/api/v1/auth/verify-email",
        json={"token": verification_token_for(email)},
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    login = r.json()
    tokens = login.get("tokens") or {}
    token = tokens.get("access_token")
    assert token, f"no access_token in login response keys={sorted(login)}"

    return user_id, {"Authorization": f"Bearer {token}"}


def _open_session() -> AsyncSession:
    return get_sessionmaker()()


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_export_returns_full_user_data(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    user_id, headers = await _register_and_login(client)

    r = await client.post(
        "/api/v1/posts",
        headers=headers,
        json={"body": "hello export", "visibility": "public"},
    )
    assert r.status_code in (200, 201), r.text

    r = await client.get("/api/v1/gdpr/export", headers=headers)
    assert r.status_code == 200, r.text
    payload = r.json()

    for key in (
        "exported_at",
        "user",
        "profile",
        "consents",
        "posts",
        "comments",
        "likes",
        "follows",
        "blocks",
        "mutes",
        "chat_rooms",
        "notifications",
        "reports_made",
    ):
        assert key in payload, f"missing top-level key: {key}"

    assert payload["user"]["id"] == user_id
    assert "@" in payload["user"]["email"]
    assert "hello export" in [p["body"] for p in payload["posts"]]


@pytest.mark.asyncio
async def test_export_after_soft_delete_forbidden(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    _, headers = await _register_and_login(client)

    r = await client.delete("/api/v1/users/me", headers=headers)
    assert r.status_code in (200, 204), r.text

    r = await client.get("/api/v1/gdpr/export", headers=headers)
    assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_delete_me_schedules_deletion(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    user_id, headers = await _register_and_login(client)

    r = await client.delete("/api/v1/users/me", headers=headers)
    assert r.status_code in (200, 204), r.text

    session = _open_session()
    try:
        user = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
        assert user.deleted_at is not None

        profile = (
            await session.execute(select(Profile).where(Profile.user_id == user_id))
        ).scalar_one()
        assert profile.deleted_at is not None

        row = (
            await session.execute(select(DeletionRequest).where(DeletionRequest.user_id == user_id))
        ).scalar_one()
        assert row.status == DeletionStatus.SCHEDULED
        delta = row.scheduled_hard_delete_at - datetime.now(UTC).replace(tzinfo=None)
        assert timedelta(days=29) < delta < timedelta(days=31)
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_schedule_twice_conflict(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    _, headers = await _register_and_login(client)

    r1 = await client.delete("/api/v1/users/me", headers=headers)
    assert r1.status_code in (200, 204), r1.text

    r2 = await client.delete("/api/v1/users/me", headers=headers)
    assert r2.status_code in (401, 403), r2.text


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cancel_deletion_restores_user_and_profile(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    user_id, headers = await _register_and_login(client)

    r = await client.delete("/api/v1/users/me", headers=headers)
    assert r.status_code in (200, 204), r.text

    r = await client.post("/api/v1/gdpr/cancel-delete", headers=headers)
    assert r.status_code == 200, r.text

    session = _open_session()
    try:
        user = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
        assert user.deleted_at is None
        assert user.is_active is True

        profile = (
            await session.execute(select(Profile).where(Profile.user_id == user_id))
        ).scalar_one()
        assert profile.deleted_at is None

        row = (
            await session.execute(select(DeletionRequest).where(DeletionRequest.user_id == user_id))
        ).scalar_one()
        assert row.status == DeletionStatus.CANCELLED
        assert row.cancelled_at is not None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_cancel_without_active_returns_error(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    _, headers = await _register_and_login(client)

    r = await client.post("/api/v1/gdpr/cancel-delete", headers=headers)
    assert r.status_code in (400, 409), r.text
    err: dict[str, Any] = r.json()
    assert "NO_ACTIVE_DELETION" in str(err.get("error", "")).upper()


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_status_none_when_no_request(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    _, headers = await _register_and_login(client)

    r = await client.get("/api/v1/gdpr/deletion-status", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "none"
    assert body["scheduled"] is False
    assert body["scheduled_hard_delete_at"] is None


@pytest.mark.asyncio
async def test_status_scheduled_after_delete(
    client: AsyncClient,
    use_testcontainers_db: str,
    fake_redis: Any,
    monkeypatch: MonkeyPatch,
) -> None:
    import social_api.modules.gdpr.service as svc_mod

    _FakeAudit.reset()
    monkeypatch.setattr(svc_mod, "AuditService", _FakeAudit)

    _, headers = await _register_and_login(client)

    r = await client.delete("/api/v1/users/me", headers=headers)
    assert r.status_code in (200, 204), r.text

    r = await client.get("/api/v1/gdpr/deletion-status", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "scheduled"
    assert body["scheduled"] is True
    assert body["scheduled_hard_delete_at"] is not None
