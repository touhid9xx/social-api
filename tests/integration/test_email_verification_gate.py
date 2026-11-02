"""The `is_verified` gate outside the login form: `deps.py` and `ws.py`.

`AuthService.login` refuses an unverified account (unit-tested in
`tests/unit/test_auth_service.py`). That alone is not enough: an access token
minted *before* the account was un-verified would otherwise keep every REST
route and every WebSocket open. These tests pin the two places that re-check
the flag per request, plus the deliberate exemption that keeps the GDPR
cancellation pair usable — a user inside the deletion grace window must be
able to cancel even if their account is unverified, otherwise the deletion
becomes unrecoverable.

There is no route that unsets `is_verified`, so the flag is flipped behind the
API's back — the same shape a support-side correction would take.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import status
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from social_api.main import create_app
from social_api.modules.auth.models import User
from tests.conftest import register_verified, register_verified_sync

pytestmark = [pytest.mark.integration]

PASSWORD = "Str0ng!Passw0rd"


def _email_hash(email: str) -> str:
    """Users are looked up by hash — raw addresses are never stored in clear."""
    return hashlib.sha256(email.lower().encode()).hexdigest()


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    """Register, consume the mailed link, then sign in."""
    await register_verified(client, email, PASSWORD)

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}


async def _set_verified(email: str, value: bool) -> None:
    """Flip the flag on the app's own engine (the test's event loop)."""
    from social_api.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        await session.execute(
            update(User).where(User.email_hash == _email_hash(email)).values(is_verified=value)
        )
        await session.commit()


def _set_verified_sync(db_url: str, email: str, value: bool) -> None:
    """Same flip from a sync test: a throwaway engine on this thread's loop.

    The sync WebSocket tests run the app inside `TestClient`'s portal thread,
    so its engine belongs to another loop. A short-lived engine of our own
    keeps the two apart (same shape as `conftest._clean_test_db`).
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    async def _run() -> None:
        engine = create_async_engine(db_url, pool_pre_ping=True)
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    update(User)
                    .where(User.email_hash == _email_hash(email))
                    .values(is_verified=value)
                )
        finally:
            await engine.dispose()

    asyncio.run(_run())


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


# ---------------------------------------------------------------------------
# REST: every route behind `get_current_user`
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_token_minted_before_unverification_stops_working(uc: AsyncClient) -> None:
    email = "gate-rest@example.com"
    h = await _login(uc, email)

    r = await uc.get("/api/v1/users/me", headers=h)
    assert r.status_code == 200, r.text

    await _set_verified(email, False)

    # Same opaque 401 as an inactive account: the gate must not tell a caller
    # what the flag is set to, only that this credential no longer works.
    for path in ("/api/v1/users/me", "/api/v1/auth/me"):
        r = await uc.get(path, headers=h)
        assert r.status_code == 401, f"{path} -> {r.status_code} {r.text}"
        assert r.json()["error"] == "UNAUTHORIZED"


# ---------------------------------------------------------------------------
# The grace-window exemption
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_grace_window_pair_survives_an_unverified_account(uc: AsyncClient) -> None:
    email = "gate-gdpr@example.com"
    h = await _login(uc, email)

    r = await uc.delete("/api/v1/users/me", headers=h)
    assert r.status_code in (200, 204), r.text

    await _set_verified(email, False)

    # Both use `get_current_user_allow_deleted`, which skips the verified
    # check on purpose: without this pair the deletion is unrecoverable.
    r = await uc.get("/api/v1/gdpr/deletion-status", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "scheduled"

    # Export is deliberately strict, so it stays shut.
    r = await uc.get("/api/v1/gdpr/export", headers=h)
    assert r.status_code == 401, r.text

    r = await uc.post("/api/v1/gdpr/cancel-delete", headers=h)
    assert r.status_code == 200, r.text

    # The account is active again — verification is now the only reason
    # the strict dependency still refuses it.
    r = await uc.get("/api/v1/gdpr/export", headers=h)
    assert r.status_code == 401, r.text


# ---------------------------------------------------------------------------
# WebSocket: the socket must not outlive the REST gate
# ---------------------------------------------------------------------------
def test_ws_refuses_an_unverified_account(integration_db_url: str) -> None:
    email = "gate-ws@example.com"
    app = create_app()

    with TestClient(app) as client:
        register_verified_sync(client, email, PASSWORD)
        r = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        token = r.json()["tokens"]["access_token"]

        _set_verified_sync(integration_db_url, email, False)

        with (
            pytest.raises(WebSocketDisconnect) as exc_info,
            client.websocket_connect(f"/api/v1/ws?token={token}"),
        ):
            pass  # pragma: no cover — connect() raises

    assert exc_info.value.code == status.WS_1008_POLICY_VIOLATION
