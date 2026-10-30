"""Registration -> verification email -> POST /auth/verify-email (real MySQL)."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app

pytestmark = [pytest.mark.integration]

_TOKEN_RE = re.compile(r"token=([\w\-.]+)")


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


def _auth(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


async def test_register_sends_verification_email(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    email = "verify-register@example.com"

    r = await api.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Str0ng!Passw0rd"},
    )

    assert r.status_code == 201, r.text
    assert len(outbox) == 1
    message = outbox[0]
    assert message["to"] == email
    assert message["subject"]
    # Deep link into the web client carrying the one-time token.
    assert "/verify-email?token=" in message["body"]


async def test_verify_email_token_flips_is_verified(
    api: AsyncClient, outbox: list[dict[str, str]]
) -> None:
    email = "verify-flow@example.com"
    password = "Str0ng!Passw0rd"

    r = await api.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    token = _token_from(outbox[0]["body"])

    # Before consuming the token: account exists but is unverified.
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    access = r.json()["tokens"]["access_token"]

    r = await api.get("/api/v1/auth/me", headers=_auth(access))
    assert r.status_code == 200
    assert r.json()["is_verified"] is False

    # Consume the token.
    r = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
    assert r.json()["message"]

    # Persisted: /me re-reads the user row on every request.
    r = await api.get("/api/v1/auth/me", headers=_auth(access))
    assert r.json()["is_verified"] is True


async def test_verify_email_is_idempotent(api: AsyncClient, outbox: list[dict[str, str]]) -> None:
    email = "verify-twice@example.com"

    r = await api.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Str0ng!Passw0rd"},
    )
    assert r.status_code == 201, r.text
    token = _token_from(outbox[0]["body"])

    first = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert first.status_code == 200, first.text

    # A second click on the same emailed link must not punish the user.
    second = await api.post("/api/v1/auth/verify-email", json={"token": token})
    assert second.status_code == 200, second.text
    assert second.json()["message"] == first.json()["message"]


async def test_verify_email_rejects_bogus_token(api: AsyncClient) -> None:
    r = await api.post(
        "/api/v1/auth/verify-email",
        json={"token": "definitely-not-a-signed-jwt"},
    )

    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_TOKEN"


async def test_verify_email_rejects_short_token(api: AsyncClient) -> None:
    r = await api.post("/api/v1/auth/verify-email", json={"token": "short"})

    assert r.status_code == 422
    assert r.json()["error"] == "VALIDATION_ERROR"
