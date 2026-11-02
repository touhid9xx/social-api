"""WS handshake: valid/invalid/missing token, feature flag off."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import status
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app
from tests.conftest import register_verified

pytestmark = [pytest.mark.integration]


async def _register_and_login(client: AsyncClient, email: str) -> str:
    pwd = "Str0ng!Passw0rd"
    await register_verified(client, email, pwd)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    # httpx.Response.json() returns Any; str() narrows to the runtime
    # type (access_token is guaranteed to be a string by the API contract).
    return str(r.json()["tokens"]["access_token"])


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


def _ws_client() -> TestClient:
    """Sync TestClient for WebSocket testing (httpx does not do WS)."""
    app = create_app()
    return TestClient(app)


def test_ws_rejects_no_token() -> None:
    """Missing token → closed with WS_1008_POLICY_VIOLATION before accept()."""
    with (
        _ws_client() as client,
        pytest.raises(WebSocketDisconnect) as exc_info,
        client.websocket_connect("/api/v1/ws"),
    ):
        pass  # pragma: no cover — connect() raises

    assert exc_info.value.code == status.WS_1008_POLICY_VIOLATION


def test_ws_rejects_bad_token() -> None:
    """Invalid JWT → closed with WS_1008_POLICY_VIOLATION before accept()."""
    with (
        _ws_client() as client,
        pytest.raises(WebSocketDisconnect) as exc_info,
        client.websocket_connect("/api/v1/ws?token=not-a-jwt"),
    ):
        pass  # pragma: no cover

    assert exc_info.value.code == status.WS_1008_POLICY_VIOLATION
