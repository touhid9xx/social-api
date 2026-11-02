"""Forgot-password -> reset email -> POST /auth/reset-password (real MySQL)."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app

pytestmark = [pytest.mark.integration]

_TOKEN_RE = re.compile(r"token=([\w\-.]+)")
_OLD_PASSWORD = "Str0ng!Passw0rd"
_NEW_PASSWORD = "N3w!Str0ngPassw0rd"


@pytest.fixture
async def api(
    use_testcontainers_db: str,
    fake_redis: object,
) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Capture dispatched email instead of hitting SMTP / Celery."""
    sent: list[dict[str, str]] = []

    async def _fake_dispatch(*, to: str, subject: str, body: str) -> None:
        sent.append({"to": to, "subject": subject, "body": body})

    from social_api.modules.auth import service as auth_service_mod

    monkeypatch.setattr(auth_service_mod, "dispatch_email", _fake_dispatch)
    return sent


def _token_from(body: str) -> str:
    match = _TOKEN_RE.search(body)
    assert match is not None, f"no token in email body: {body!r}"
    return match.group(1)


async def _register(
    api: AsyncClient,
    outbox: list[dict[str, str]],
    *,
    email: str,
    password: str = _OLD_PASSWORD,
) -> None:
    """Register and consume the verification link.

    ``/auth/login`` refuses an unverified account (403 ``EMAIL_NOT_VERIFIED``),
    and several cases below assert on sign-in, so the account has to be
    verified first. This uses the file's own ``outbox`` rather than the shared
    helper because the local ``outbox`` fixture re-patches ``dispatch_email``
    and the conftest capture would therefore see nothing.
    """
    r = await api.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    token = _token_from(outbox[0]["body"])
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text


async def test_forgot_password_emails_reset_token(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    email = "reset-email@example.com"
    await _register(api, outbox, email=email)
    outbox.clear()

    r = await api.post("/api/v1/auth/forgot-password", json={"email": email})

    assert r.status_code == 200, r.text
    assert len(outbox) == 1
    assert outbox[0]["to"] == email
    assert "/reset-password?token=" in outbox[0]["body"]


async def test_reset_password_flow(api: AsyncClient, outbox: list[dict[str, str]]) -> None:
    email = "reset-flow@example.com"
    await _register(api, outbox, email=email)
    outbox.clear()

    r = await api.post("/api/v1/auth/forgot-password", json={"email": email})
    assert r.status_code == 200, r.text
    token = _token_from(outbox[0]["body"])

    # Consume the token.
    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": _NEW_PASSWORD},
    )
    assert r.status_code == 200, r.text

    # Old password no longer works...
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": _OLD_PASSWORD})
    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_CREDENTIALS"

    # ...the new one does.
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": _NEW_PASSWORD})
    assert r.status_code == 200, r.text

    # The token is single-use: its `pwh` no longer matches the stored hash.
    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "Yet!An0therStr0ngPwd"},
    )
    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_TOKEN"


async def test_forgot_password_does_not_reveal_account_existence(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    known = "reset-known@example.com"
    unknown = "reset-unknown@example.com"
    await _register(api, outbox, email=known)
    outbox.clear()

    known_response = await api.post("/api/v1/auth/forgot-password", json={"email": known})
    outbox.clear()
    unknown_response = await api.post("/api/v1/auth/forgot-password", json={"email": unknown})

    assert known_response.status_code == unknown_response.status_code == 200
    assert known_response.json() == unknown_response.json()
    # Only the real account produced an email — but the caller cannot tell.
    assert outbox == []


async def test_forgot_password_for_unknown_email_sends_nothing(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    r = await api.post("/api/v1/auth/forgot-password", json={"email": "nobody-here@example.com"})

    assert r.status_code == 200
    assert r.json()["message"]
    assert outbox == []


async def test_reset_password_rejects_verification_token(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    """Token types are not interchangeable: 'verify' cannot reset a password."""
    email = "reset-wrong-type@example.com"
    await _register(api, outbox, email=email)
    verification_token = _token_from(outbox[0]["body"])

    r = await api.post(
        "/api/v1/auth/reset-password",
        json={"token": verification_token, "new_password": _NEW_PASSWORD},
    )

    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_TOKEN"

    # Password unchanged.
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": _OLD_PASSWORD})
    assert r.status_code == 200, r.text


async def test_reset_password_enforces_password_policy(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    email = "reset-weak@example.com"
    await _register(api, outbox, email=email)
    outbox.clear()

    r = await api.post("/api/v1/auth/forgot-password", json={"email": email})
    assert r.status_code == 200, r.text
    token = _token_from(outbox[0]["body"])

    r = await api.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "weak"})

    assert r.status_code == 422
    assert r.json()["error"] == "VALIDATION_ERROR"
