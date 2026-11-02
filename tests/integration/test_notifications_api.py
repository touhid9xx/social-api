"""End-to-end notifications flow."""

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


async def test_follow_creates_notification(uc: AsyncClient) -> None:
    a = await _login(uc, "notif-a@example.com")
    b = await _login(uc, "notif-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # A follows B
    await uc.post(f"/api/v1/follows/{b['user_id']}", headers=ha)

    # B has one unread notification
    r = await uc.get("/api/v1/notifications/unread-count", headers=hb)
    assert r.status_code == 200
    assert r.json()["unread"] == 1

    # List
    r = await uc.get("/api/v1/notifications", headers=hb)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["type"] == "follow"
    assert items[0]["actor_id"] == int(a["user_id"])
    assert items[0]["is_read"] is False

    # Mark read
    notif_id = items[0]["id"]
    r = await uc.post(f"/api/v1/notifications/{notif_id}/read", headers=hb)
    assert r.status_code == 200
    assert r.json()["is_read"] is True

    # Unread count -> 0
    r = await uc.get("/api/v1/notifications/unread-count", headers=hb)
    assert r.json()["unread"] == 0


async def test_like_creates_notification(uc: AsyncClient) -> None:
    a = await _login(uc, "nl-a@example.com")
    b = await _login(uc, "nl-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # B creates a post
    r = await uc.post("/api/v1/posts", headers=hb, json={"body": "hi"})
    pid = r.json()["id"]

    # A likes it
    await uc.post(f"/api/v1/likes/post/{pid}", headers=ha)

    # B unread count = 1
    r = await uc.get("/api/v1/notifications/unread-count", headers=hb)
    assert r.json()["unread"] == 1


async def test_self_like_no_notification(uc: AsyncClient) -> None:
    a = await _login(uc, "self-like@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "mine"})
    pid = r.json()["id"]

    await uc.post(f"/api/v1/likes/post/{pid}", headers=ha)

    r = await uc.get("/api/v1/notifications/unread-count", headers=ha)
    assert r.json()["unread"] == 0


async def test_double_like_single_notification(uc: AsyncClient) -> None:
    a = await _login(uc, "dl-a@example.com")
    b = await _login(uc, "dl-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    r = await uc.post("/api/v1/posts", headers=hb, json={"body": "x"})
    pid = r.json()["id"]

    await uc.post(f"/api/v1/likes/post/{pid}", headers=ha)
    await uc.post(f"/api/v1/likes/post/{pid}", headers=ha)  # idempotent

    r = await uc.get("/api/v1/notifications/unread-count", headers=hb)
    assert r.json()["unread"] == 1


async def test_mark_all_read(uc: AsyncClient) -> None:
    a = await _login(uc, "mar-a@example.com")
    b = await _login(uc, "mar-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # Create two notifications: A follows B; A creates a post; B likes it.
    await uc.post(f"/api/v1/follows/{b['user_id']}", headers=ha)
    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "x"})
    pid = r.json()["id"]
    await uc.post(f"/api/v1/likes/post/{pid}", headers=hb)

    r = await uc.get("/api/v1/notifications/unread-count", headers=ha)
    assert r.json()["unread"] >= 1

    r = await uc.post("/api/v1/notifications/read-all", headers=ha)
    assert r.status_code == 200
    assert r.json()["updated"] >= 1

    r = await uc.get("/api/v1/notifications/unread-count", headers=ha)
    assert r.json()["unread"] == 0
