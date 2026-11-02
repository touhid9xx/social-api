"""End-to-end chat flow."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app
from tests.conftest import register_verified

pytestmark = [pytest.mark.integration]


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    pwd = "Str0ng!Passw0rd"
    await register_verified(client, email, pwd)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    body = r.json()
    return {
        "access": body["tokens"]["access_token"],
        "user_id": str(body["user"]["id"]),
    }


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_direct_chat_full_flow(uc: AsyncClient) -> None:
    a = await _login(uc, "chat-a@example.com")
    b = await _login(uc, "chat-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # A creates direct room with B
    r = await uc.post(
        "/api/v1/chat/rooms/direct",
        headers=ha,
        json={"other_user_id": int(b["user_id"])},
    )
    assert r.status_code == 200, r.text
    room_id = r.json()["id"]
    assert r.json()["type"] == "direct"

    # Second call idempotent
    r2 = await uc.post(
        "/api/v1/chat/rooms/direct",
        headers=ha,
        json={"other_user_id": int(b["user_id"])},
    )
    assert r2.json()["id"] == room_id

    # B sees room in "my rooms"
    r = await uc.get("/api/v1/chat/rooms", headers=hb)
    assert any(room["id"] == room_id for room in r.json())

    # A sends message
    r = await uc.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        headers=ha,
        json={"body": "hello B"},
    )
    assert r.status_code == 201
    mid = r.json()["id"]

    # B's unread count = 1
    r = await uc.get(f"/api/v1/chat/rooms/{room_id}/unread-count", headers=hb)
    assert r.json()["unread"] == 1

    # B reads
    r = await uc.post(
        f"/api/v1/chat/rooms/{room_id}/read",
        headers=hb,
        json={"message_id": mid},
    )
    assert r.status_code == 200
    assert r.json()["last_read_message_id"] == mid

    # B's unread now 0
    r = await uc.get(f"/api/v1/chat/rooms/{room_id}/unread-count", headers=hb)
    assert r.json()["unread"] == 0

    # B lists messages
    r = await uc.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=hb)
    assert len(r.json()["items"]) == 1
    assert r.json()["items"][0]["body"] == "hello B"

    # Non-member can't access
    c = await _login(uc, "chat-c@example.com")
    hc = {"Authorization": f"Bearer {c['access']}"}
    r = await uc.get(f"/api/v1/chat/rooms/{room_id}/messages", headers=hc)
    assert r.status_code == 403
