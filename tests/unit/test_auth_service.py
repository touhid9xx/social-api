"""Auth service — the sign-in verification gate and the self-serve resend.

These are pure unit tests: the repository, the audit writer, the mailer and
(where needed) Redis are faked, so nothing here touches MySQL or SMTP. The
end-to-end behaviour of the same gate is covered by
`tests/integration/test_email_verification.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, ClassVar

import pytest

from social_api.modules.auth.exceptions import (
    EmailNotVerifiedError,
    InactiveUserError,
    InvalidCredentialsError,
    InvalidTokenError,
)
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.service import AuthService

if TYPE_CHECKING:
    MonkeyPatch = pytest.MonkeyPatch

pytestmark = pytest.mark.unit

_PASSWORD = "Str0ng!Passw0rd"
# Hash of _PASSWORD, computed once by the auth module's own hasher so the
# fixture can never drift from the policy the service verifies against.
_PASSWORD_HASH = ""
# Filled by the autouse fixture below; shared so the fixture stays a plain
# side effect rather than a returned value every test has to inject.
_OUTBOX: list[dict[str, str]] = []


def _user(
    *,
    is_active: bool = True,
    is_verified: bool = True,
    email: str = "unverified@example.com",
) -> User:
    u = User(
        id=7,
        email=email,
        email_hash="h",
        password_hash=_PASSWORD_HASH,
        role=UserRole.USER,
        is_active=is_active,
        is_verified=is_verified,
    )
    u.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    u.updated_at = datetime(2026, 1, 1, tzinfo=UTC)
    u.deleted_at = None
    u.last_login_at = None
    return u


class _FakeUserRepo:
    def __init__(self, user: User | None) -> None:
        self.user = user
        self.saved: list[User] = []

    async def get_by_email(self, email: str) -> User | None:
        if self.user is not None and self.user.email == email:
            return self.user
        return None

    async def get_by_id(self, user_id: int) -> User | None:
        if self.user is not None and self.user.id == user_id:
            return self.user
        return None

    async def save(self, user: User) -> User:
        self.saved.append(user)
        return user


class _FakeAudit:
    """Stands in for `AuditService`; records (action, entity_id) pairs."""

    calls: ClassVar[list[tuple[str, int]]] = []

    def __init__(self, _session: Any) -> None:
        pass

    async def write(self, *, actor_id: int, action: str, entity: str, entity_id: int) -> None:
        type(self).calls.append((action, entity_id))


class _FakeRedis:
    async def exists(self, _key: str) -> int:
        return 0

    async def set(self, *_args: Any, **_kwargs: Any) -> bool:  # revoke_token path
        return True

    async def delete(self, *_args: Any, **_kwargs: Any) -> int:
        return 1


@pytest.fixture(autouse=True)
def _patch_collaborators(monkeypatch: MonkeyPatch) -> None:
    """Replace the mailer and the audit writer; reset the captured outbox."""
    global _PASSWORD_HASH
    if not _PASSWORD_HASH:
        from social_api.core.password import hash_password

        _PASSWORD_HASH = hash_password(_PASSWORD)

    _FakeAudit.calls = []
    _OUTBOX.clear()

    async def _fake_dispatch(*, to: str, subject: str, body: str) -> None:
        _OUTBOX.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr("social_api.modules.auth.service.dispatch_email", _fake_dispatch)
    monkeypatch.setattr("social_api.modules.auth.service.AuditService", _FakeAudit)


def _service(user: User | None) -> tuple[AuthService, _FakeUserRepo]:
    svc = AuthService(session=object())  # type: ignore[arg-type]
    repo = _FakeUserRepo(user)
    svc._repo = repo  # type: ignore[assignment]  # narrow fake, same surface
    return svc, repo


@pytest.mark.asyncio
async def test_login_refuses_unverified_account() -> None:
    svc, repo = _service(_user(is_verified=False))

    with pytest.raises(EmailNotVerifiedError):
        await svc.login(email="unverified@example.com", password=_PASSWORD)

    assert repo.saved == []  # no last_login_at write, no session minted


@pytest.mark.asyncio
async def test_login_checks_active_before_verified() -> None:
    """A disabled account reports *disabled*, not "click your link"."""
    svc, _ = _service(_user(is_active=False, is_verified=False))

    with pytest.raises(InactiveUserError):
        await svc.login(email="unverified@example.com", password=_PASSWORD)


@pytest.mark.asyncio
async def test_login_checks_password_before_verified() -> None:
    """A wrong password must not reveal account state (no oracle for attackers)."""
    svc, _ = _service(_user(is_verified=False))

    with pytest.raises(InvalidCredentialsError):
        await svc.login(email="unverified@example.com", password="Wrong!12345678")


@pytest.mark.asyncio
async def test_login_accepts_verified_account_and_stamps_last_login() -> None:
    svc, repo = _service(_user())

    result = await svc.login(email="unverified@example.com", password=_PASSWORD)

    assert result.user.is_verified is True
    assert result.tokens.access_token
    assert repo.saved
    assert repo.saved[0].last_login_at is not None
    assert ("LOGIN", 7) in _FakeAudit.calls


@pytest.mark.asyncio
async def test_refresh_refuses_unverified_account(monkeypatch: MonkeyPatch) -> None:
    """A refresh token minted before the gate must not outlive it."""
    from social_api.core.security import issue_refresh_token

    token, _jti, _ = issue_refresh_token(user_id=7, role="user")
    monkeypatch.setattr("social_api.modules.auth.service.get_redis", lambda: _FakeRedis())
    svc, _ = _service(_user(is_verified=False))

    with pytest.raises(EmailNotVerifiedError):
        await svc.refresh(refresh_token=token)


@pytest.mark.asyncio
async def test_refresh_rejects_non_refresh_token(monkeypatch: MonkeyPatch) -> None:
    from social_api.core.security import issue_access_token

    token, _jti, _ = issue_access_token(user_id=7, role="user")
    monkeypatch.setattr("social_api.modules.auth.service.get_redis", lambda: _FakeRedis())
    svc, _ = _service(_user())

    with pytest.raises(InvalidTokenError):
        await svc.refresh(refresh_token=token)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user",
    [
        None,
        _user(is_verified=True),
        _user(is_active=False, is_verified=False),
    ],
    ids=["unknown", "already-verified", "inactive"],
)
async def test_resend_is_silent_for_addresses_it_cannot_help(user: User | None) -> None:
    """No enumeration oracle, no mail, no audit row — but the same 200."""
    svc, _ = _service(user)

    result = await svc.resend_verification(email="someone@example.com")

    assert result.message
    assert _OUTBOX == []
    assert _FakeAudit.calls == []


@pytest.mark.asyncio
async def test_resend_emails_link_to_unverified_account() -> None:
    svc, _ = _service(_user(is_verified=False, email="someone@example.com"))

    result = await svc.resend_verification(email="someone@example.com")

    assert len(_OUTBOX) == 1
    assert _OUTBOX[0]["to"] == "someone@example.com"
    assert "token=" in _OUTBOX[0]["body"]
    assert ("RESEND_VERIFICATION", 7) in _FakeAudit.calls
    # The caller cannot tell this apart from the silent cases above.
    silent, _ = _service(None)
    assert result.message == (await silent.resend_verification(email="nobody@example.com")).message
