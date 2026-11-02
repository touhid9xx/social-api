"""End-to-end notifications flow."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from social_api.main import create_app
from social_api.modules.auth.models import User, UserRole
from tests.conftest import register_verified

pytestmark = [pytest.mark.integration]

PASSWORD = "Str0ng!Passw0rd"


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    pwd = PASSWORD
    await register_verified(client, email, pwd)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    body = r.json()
    return {
        "access": body["tokens"]["access_token"],
        "user_id": str(body["user"]["id"]),
    }


async def _promote_to_admin(email: str) -> None:
    from social_api.db.session import get_sessionmaker

    sm = get_sessionmaker()
    async with sm() as session:
        await session.execute(
            update(User)
            .where(User.email_hash == hashlib.sha256(email.lower().encode()).hexdigest())
            .values(role=UserRole.ADMIN)
        )
        await session.commit()


async def _admin(client: AsyncClient, email: str) -> dict[str, str]:
    """Register, promote, then re-login so the JWT carries role=ADMIN."""
    await _login(client, email)
    await _promote_to_admin(email)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
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


async def test_scope_splits_staff_traffic_from_the_personal_inbox(uc: AsyncClient) -> None:
    """`?scope=` partitions one inbox table into two screens.

    `admin_new_user` is operational traffic (an account awaiting review), so it
    must be invisible to the personal inbox but visible on the staff console —
    and each screen must be able to clear its own unread counter without the
    other's badge moving.
    """
    admin = await _admin(uc, "scope-admin@example.com")
    ha = {"Authorization": f"Bearer {admin['access']}"}

    # Registering a second account alerts the admin (system traffic)...
    follower = await _login(uc, "scope-follower@example.com")
    hf = {"Authorization": f"Bearer {follower['access']}"}

    # ...and following the admin is ordinary social activity.
    r = await uc.post(f"/api/v1/follows/{admin['user_id']}", headers=hf)
    assert r.status_code in (200, 201, 204), r.text

    # Default scope is unchanged: everything.
    r = await uc.get("/api/v1/notifications", headers=ha)
    assert r.status_code == 200
    assert {i["type"] for i in r.json()["items"]} == {"admin_new_user", "follow"}

    r = await uc.get("/api/v1/notifications?scope=system", headers=ha)
    assert r.status_code == 200
    assert [i["type"] for i in r.json()["items"]] == ["admin_new_user"]

    r = await uc.get("/api/v1/notifications?scope=social", headers=ha)
    assert r.status_code == 200
    assert [i["type"] for i in r.json()["items"]] == ["follow"]

    # One unread on each side.
    assert (await uc.get("/api/v1/notifications/unread-count?scope=system", headers=ha)).json()[
        "unread"
    ] == 1
    assert (await uc.get("/api/v1/notifications/unread-count?scope=social", headers=ha)).json()[
        "unread"
    ] == 1
    assert (await uc.get("/api/v1/notifications/unread-count", headers=ha)).json()["unread"] == 2

    # Clearing the social slice leaves the staff queue untouched.
    r = await uc.post("/api/v1/notifications/read-all?scope=social", headers=ha)
    assert r.status_code == 200
    assert r.json()["updated"] == 1

    assert (await uc.get("/api/v1/notifications/unread-count?scope=social", headers=ha)).json()[
        "unread"
    ] == 0
    assert (await uc.get("/api/v1/notifications/unread-count?scope=system", headers=ha)).json()[
        "unread"
    ] == 1
    assert (await uc.get("/api/v1/notifications/unread-count", headers=ha)).json()["unread"] == 1


async def test_scope_rejects_an_unknown_slice(uc: AsyncClient) -> None:
    """The literal union is enforced at the edge, not silently ignored."""
    a = await _login(uc, "scope-bad@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    r = await uc.get("/api/v1/notifications?scope=nope", headers=ha)
    assert r.status_code == 422, r.text
