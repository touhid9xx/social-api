"""Full-lifecycle E2E test — one user journey through 15 milestones."""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from social_api.db.session import get_sessionmaker
from social_api.main import create_app
from social_api.modules.auth.models import User, UserRole

pytestmark = [pytest.mark.e2e]


PWD = "Str0ng!Passw0rd"


async def _promote(email: str, role: UserRole) -> None:
    sm = get_sessionmaker()
    async with sm() as s:
        await s.execute(
            update(User)
            .where(User.email_hash == hashlib.sha256(email.lower().encode()).hexdigest())
            .values(role=role)
        )
        await s.commit()


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    await client.post("/api/v1/auth/register", json={"email": email, "password": PWD})
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PWD})
    body = r.json()
    return {
        "access": body["tokens"]["access_token"],
        "refresh": body["tokens"]["refresh_token"],
        "user_id": str(body["user"]["id"]),
    }


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_full_lifecycle(uc: AsyncClient) -> None:
    # 1. Register Alice + Bob + Mod
    alice = await _register_and_login(uc, "alice@e2e.com")
    bob = await _register_and_login(uc, "bob@e2e.com")
    mod = await _register_and_login(uc, "mod@e2e.com")
    ha = {"Authorization": f"Bearer {alice['access']}"}
    hb = {"Authorization": f"Bearer {bob['access']}"}
    hm = {"Authorization": f"Bearer {mod['access']}"}

    # 2. Alice profile exists (auto-created M5/M6)
    r = await uc.get("/api/v1/users/me", headers=ha)
    assert r.status_code == 200
    v = r.json()["version"]

    # 3. Alice updates profile
    r = await uc.patch(
        "/api/v1/users/me",
        headers=ha,
        json={"version": v, "display_name": "Alice", "bio": "E2E test"},
    )
    assert r.status_code == 200

    # 4. Alice creates 3 posts
    pids: list[int] = []
    for i in range(3):
        r = await uc.post("/api/v1/posts", headers=ha, json={"body": f"Alice post {i}"})
        assert r.status_code == 201
        pids.append(r.json()["id"])

    # 5. Bob follows Alice -> audit + feed backfill
    r = await uc.post(f"/api/v1/follows/{alice['user_id']}", headers=hb)
    assert r.status_code == 204

    # 6. Alice gets follow notification
    r = await uc.get("/api/v1/notifications/unread-count", headers=ha)
    assert r.json()["unread"] >= 1

    # 7. Bob likes first post
    r = await uc.post(f"/api/v1/likes/post/{pids[0]}", headers=hb)
    assert r.status_code == 204

    # 8. Bob comments on first post
    r = await uc.post(
        f"/api/v1/posts/{pids[0]}/comments",
        headers=hb,
        json={"body": "Great post!"},
    )
    assert r.status_code == 201
    r.json()["id"]

    # 9. Alice feed contains her own posts
    r = await uc.get("/api/v1/feed/home", headers=ha)
    assert r.status_code == 200
    alice_feed_ids = {p["id"] for p in r.json()["items"]}
    assert pids[0] in alice_feed_ids

    # 10. Bob feed contains Alice's posts
    r = await uc.get("/api/v1/feed/home", headers=hb)
    bob_feed_ids = {p["id"] for p in r.json()["items"]}
    assert pids[0] in bob_feed_ids

    # 11. Alice creates group chat with Bob
    r = await uc.post(
        "/api/v1/chat/rooms/group",
        headers=ha,
        json={"title": "E2E Group", "member_ids": [int(bob["user_id"])]},
    )
    assert r.status_code == 201
    room_id = r.json()["id"]

    # 12. Alice sends a message
    r = await uc.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        headers=ha,
        json={"body": "Hi Bob!"},
    )
    assert r.status_code == 201
    msg_id = r.json()["id"]

    # 13. Bob marks read
    r = await uc.post(
        f"/api/v1/chat/rooms/{room_id}/read",
        headers=hb,
        json={"message_id": msg_id},
    )
    assert r.status_code == 200
    assert r.json()["last_read_message_id"] == msg_id

    # 14. Bob reports Alice's post
    r = await uc.post(
        "/api/v1/moderation/reports",
        headers=hb,
        json={
            "target_type": "post",
            "target_id": pids[0],
            "reason": "spam",
        },
    )
    assert r.status_code == 201
    report_id = r.json()["id"]

    # 15. Promote mod -> resolve report
    await _promote("mod@e2e.com", UserRole.MODERATOR)
    r = await uc.post(
        "/api/v1/auth/login",
        json={"email": "mod@e2e.com", "password": PWD},
    )
    mod_token = r.json()["tokens"]["access_token"]
    hm = {"Authorization": f"Bearer {mod_token}"}

    r = await uc.patch(
        f"/api/v1/moderation/reports/{report_id}",
        headers=hm,
        json={"status": "resolved", "version": 1, "resolution_note": "handled"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"

    # 16. Alice gets GDPR export
    r = await uc.get("/api/v1/gdpr/export", headers=ha)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "alice@e2e.com"
    assert len(body["posts"]) >= 3
    assert len(body["chat_rooms"]) >= 1

    # 17. Alice schedules deletion + cancels
    r = await uc.delete("/api/v1/users/me", headers=ha)
    assert r.status_code == 200

    # After soft-delete, cancel via the allow-deleted dep
    # Alice's access token still valid; cancel works
    r = await uc.post("/api/v1/gdpr/cancel-delete", headers=ha)
    assert r.status_code == 200
    assert "restored" in r.json()["message"].lower()

    # Verify user is active again
    r = await uc.get("/api/v1/users/me", headers=ha)
    assert r.status_code == 200


def test_full_lifecycle_ws_notification() -> None:
    """
    Separate test for the realtime layer — uses TestClient (sync WS).
    Verifies end-to-end push: Bob follows Alice → Alice's WS receives it.
    """
    app = create_app()
    with TestClient(app) as client:
        pwd = PWD

        for email in ("ws-alice@e2e.com", "ws-bob@e2e.com"):
            client.post(
                "/api/v1/auth/register",
                json={"email": email, "password": pwd},
            )

        alice_t = client.post(
            "/api/v1/auth/login",
            json={"email": "ws-alice@e2e.com", "password": pwd},
        ).json()
        bob_t = client.post(
            "/api/v1/auth/login",
            json={"email": "ws-bob@e2e.com", "password": pwd},
        ).json()

        alice_id = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {alice_t['tokens']['access_token']}"},
        ).json()["id"]

        with client.websocket_connect(
            f"/api/v1/ws?token={alice_t['tokens']['access_token']}"
        ) as ws:
            # Bob follows
            client.post(
                f"/api/v1/follows/{alice_id}",
                headers={"Authorization": f"Bearer {bob_t['tokens']['access_token']}"},
            )
            # Drain pings until notification
            raw = ws.receive_text()
            parsed = json.loads(raw)
            while parsed.get("type") == "ping":
                raw = ws.receive_text()
                parsed = json.loads(raw)
            assert parsed["type"] == "notification"
            assert parsed["data"]["type"] == "follow"
