"""Audit service: PII redaction + write semantics."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.audit.models import AuditLog
from social_api.modules.audit.service import AuditService, redact_payload

pytestmark = pytest.mark.unit


def test_redact_top_level_pii() -> None:
    out = redact_payload(
        {
            "email": "alice@example.com",
            "phone": "+8801700000000",
            "display_name": "Alice",
        }
    )
    assert out is not None
    assert out["email"] == "***REDACTED***"
    assert out["phone"] == "***REDACTED***"
    assert out["display_name"] == "Alice"


def test_redact_nested_dict() -> None:
    out = redact_payload(
        {
            "user": {
                "email": "alice@example.com",
                "address": "1 Main St",
                "id": 42,
            },
            "action": "LOGIN",
        }
    )
    assert out is not None
    assert out["user"]["email"] == "***REDACTED***"
    assert out["user"]["address"] == "***REDACTED***"
    assert out["user"]["id"] == 42


def test_redact_password_hash_extra() -> None:
    out = redact_payload({"password_hash": "$argon2id$v=19$..."})
    assert out is not None
    assert out["password_hash"] == "***REDACTED***"


def test_redact_list_of_dicts() -> None:
    out = redact_payload({"items": [{"email": "a@b.com"}, {"phone": "+1"}]})
    assert out is not None
    assert out["items"][0]["email"] == "***REDACTED***"
    assert out["items"][1]["phone"] == "***REDACTED***"


def test_redact_none_passthrough() -> None:
    assert redact_payload(None) is None


class _FakeRepo:
    def __init__(self) -> None:
        self.rows: list[AuditLog] = []
        self._next_id = 1

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
            id=self._next_id,
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            before=before,
            after=after,
            ip=ip,
            user_agent=user_agent,
            request_id=request_id,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            deleted_at=None,
            version=1,
        )
        self._next_id += 1
        self.rows.append(row)
        return row


@pytest.mark.asyncio
async def test_write_redacts_before_insert() -> None:
    repo = _FakeRepo()
    svc = AuditService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]

    await svc.write(
        actor_id=1,
        action="PROFILE_UPDATE",
        entity="profile",
        entity_id=10,
        before={"email": "old@example.com"},
        after={"email": "new@example.com", "display_name": "Alice"},
    )
    assert len(repo.rows) == 1
    row = repo.rows[0]
    assert row.before is not None
    assert row.before["email"] == "***REDACTED***"
    assert row.after is not None
    assert row.after["email"] == "***REDACTED***"
    assert row.after["display_name"] == "Alice"


@pytest.mark.asyncio
async def test_write_never_raises() -> None:
    """If repo fails, write() logs and returns; caller proceeds."""

    class _BoomRepo:
        async def create(self, **kw: Any) -> AuditLog:
            raise RuntimeError("DB down")

    svc = AuditService(session=None)  # type: ignore[arg-type]
    svc._repo = _BoomRepo()  # type: ignore[assignment]

    # Must not raise
    await svc.write(actor_id=1, action="LOGIN", entity="user", entity_id=1)
