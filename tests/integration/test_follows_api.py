"""End-to-end follows flow."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app

pytestmark = [pytest.mark.integration]


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    pwd = "Str0ng!Passw0rd"
    await client.post("/api/v1/auth/register", json={"email": email, "password": pwd})
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    body = r.json()
    return {
        "access": body["tokens"]["access_token"],
        "user_id": str(body["user"]["id"]),
    }


@pytest.fixture
async def uc(
    use_testcontainers_db: str,
    fake_redis: object,
) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_follow_unfollow_flow(uc: AsyncClient) -> None:
    a = await _login(uc, "a@example.com")
    b = await _login(uc, "b@example.com")

    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # Follow
    r = await uc.post(f"/api/v1/follows/{b['user_id']}", headers=ha)
    assert r.status_code == 204

    # Idempotent double-follow
    r = await uc.post(f"/api/v1/follows/{b['user_id']}", headers=ha)
    assert r.status_code == 204

    # Status
    r = await uc.get(f"/api/v1/users/{b['user_id']}/follow-status", headers=ha)
    assert r.status_code == 200
    assert r.json()["is_following"] is True
    assert r.json()["is_followed_by"] is False

    # B sees follower
    r = await uc.get(f"/api/v1/users/{b['user_id']}/followers", headers=hb)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert str(items[0]["user_id"]) == a["user_id"]

    # Unfollow
    r = await uc.delete(f"/api/v1/follows/{b['user_id']}", headers=ha)
    assert r.status_code == 204

    # Status now false
    r = await uc.get(f"/api/v1/users/{b['user_id']}/follow-status", headers=ha)
    assert r.json()["is_following"] is False


async def test_block_silently_unfollows(uc: AsyncClient) -> None:
    a = await _login(uc, "ablock@example.com")
    b = await _login(uc, "bblock@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # Mutual follow
    await uc.post(f"/api/v1/follows/{b['user_id']}", headers=ha)
    await uc.post(f"/api/v1/follows/{a['user_id']}", headers=hb)

    # A blocks B
    r = await uc.post(f"/api/v1/blocks/{b['user_id']}", headers=ha)
    assert r.status_code == 204

    # Both follows removed
    r = await uc.get(f"/api/v1/users/{b['user_id']}/follow-status", headers=ha)
    assert r.json()["is_following"] is False
    assert r.json()["is_blocked_by_me"] is True

    # B tries to follow A -> 403
    r = await uc.post(f"/api/v1/follows/{a['user_id']}", headers=hb)
    assert r.status_code == 403
    assert r.json()["error"] == "USER_BLOCKED"


async def test_followers_visibility_unlock(uc: AsyncClient) -> None:
    owner = await _login(uc, "owner2@example.com")
    viewer = await _login(uc, "viewer2@example.com")
    other = await _login(uc, "other2@example.com")

    ho = {"Authorization": f"Bearer {owner['access']}"}
    hv = {"Authorization": f"Bearer {viewer['access']}"}
    hoth = {"Authorization": f"Bearer {other['access']}"}

    # Set profile visibility = followers
    r = await uc.patch(
        "/api/v1/users/me",
        headers=ho,
        json={"version": 1, "visibility": "followers"},
    )
    assert r.status_code == 200

    # Viewer not following -> 403
    r = await uc.get(f"/api/v1/users/{owner['user_id']}", headers=hv)
    assert r.status_code == 403

    # Viewer follows owner
    await uc.post(f"/api/v1/follows/{owner['user_id']}", headers=hv)

    # Now allowed
    r = await uc.get(f"/api/v1/users/{owner['user_id']}", headers=hv)
    assert r.status_code == 200

    # Other (non-follower) still 403
    r = await uc.get(f"/api/v1/users/{owner['user_id']}", headers=hoth)
    assert r.status_code == 403


async def test_pagination(uc: AsyncClient) -> None:
    owner = await _login(uc, "pagination-owner@example.com")
    ho = {"Authorization": f"Bearer {owner['access']}"}

    # 5 followers
    for i in range(5):
        f = await _login(uc, f"follower{i}@example.com")
        hf = {"Authorization": f"Bearer {f['access']}"}
        await uc.post(f"/api/v1/follows/{owner['user_id']}", headers=hf)

    # First page limit=2
    r = await uc.get(f"/api/v1/users/{owner['user_id']}/followers?limit=2", headers=ho)
    body = r.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None

    # Next page
    r2 = await uc.get(
        f"/api/v1/users/{owner['user_id']}/followers?limit=2&cursor={body['next_cursor']}",
        headers=ho,
    )
    assert r2.status_code == 200
    assert len(r2.json()["items"]) >= 1
    # No overlap
    ids_page1 = {item["user_id"] for item in body["items"]}
    ids_page2 = {item["user_id"] for item in r2.json()["items"]}
    assert ids_page1.isdisjoint(ids_page2)
