"""End-to-end posts + comments + likes."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
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


async def test_create_get_update_delete_post(uc: AsyncClient) -> None:
    a = await _login(uc, "post-author@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    # Create
    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "hello world"})
    assert r.status_code == 201, r.text
    post = r.json()
    assert post["body"] == "hello world"
    assert post["visibility"] == "public"
    assert post["like_count"] == 0
    pid = post["id"]

    # Get
    r = await uc.get(f"/api/v1/posts/{pid}", headers=ha)
    assert r.status_code == 200

    # Update with correct version
    r = await uc.patch(
        f"/api/v1/posts/{pid}",
        headers=ha,
        json={"body": "edited", "version": 1},
    )
    assert r.status_code == 200
    assert r.json()["body"] == "edited"
    assert r.json()["is_edited"] is True
    new_version = r.json()["version"]
    assert new_version == 2  # version bumped by the update

    # Stale update with the OLD version -> 409
    r = await uc.patch(
        f"/api/v1/posts/{pid}",
        headers=ha,
        json={"body": "again", "version": 1},
    )
    assert r.status_code == 409

    # Delete
    r = await uc.delete(f"/api/v1/posts/{pid}", headers=ha)
    assert r.status_code == 204

    # Get after delete -> 404
    r = await uc.get(f"/api/v1/posts/{pid}", headers=ha)
    assert r.status_code == 404


async def test_like_unlike_idempotent(uc: AsyncClient) -> None:
    a = await _login(uc, "liker@example.com")
    b = await _login(uc, "poster@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # b creates a post
    r = await uc.post("/api/v1/posts", headers=hb, json={"body": "likable"})
    pid = r.json()["id"]

    # a likes -> 204
    r = await uc.post(f"/api/v1/likes/post/{pid}", headers=ha)
    assert r.status_code == 204

    # double like -> 204 (idempotent)
    r = await uc.delete(f"/api/v1/likes/post/{pid}", headers=ha)
    assert r.status_code == 204

    # Unlike drops the count back to 0.
    r = await uc.get(f"/api/v1/posts/{pid}", headers=ha)
    assert r.json()["like_count"] == 0

    # unlike
    r = await uc.delete(f"/api/v1/likes/post/{pid}", headers=ha)
    assert r.status_code == 204

    # count back to 0
    r = await uc.get(f"/api/v1/posts/{pid}", headers=ha)
    assert r.json()["like_count"] == 0


async def test_comment_depth_limit(uc: AsyncClient) -> None:
    a = await _login(uc, "c1@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "P"})
    pid = r.json()["id"]

    # Top-level comment
    r = await uc.post(f"/api/v1/posts/{pid}/comments", headers=ha, json={"body": "L1"})
    assert r.status_code == 201
    c1 = r.json()["id"]

    # Reply (depth 2)
    r = await uc.post(
        f"/api/v1/posts/{pid}/comments",
        headers=ha,
        json={"body": "L2", "parent_id": c1},
    )
    assert r.status_code == 201
    c2 = r.json()["id"]

    # Reply to reply (depth 3) -> 400
    r = await uc.post(
        f"/api/v1/posts/{pid}/comments",
        headers=ha,
        json={"body": "L3", "parent_id": c2},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "COMMENT_DEPTH_EXCEEDED"


async def test_pagination_by_author(uc: AsyncClient) -> None:
    a = await _login(uc, "pag@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    for i in range(5):
        await uc.post("/api/v1/posts", headers=ha, json={"body": f"P{i}"})

    r = await uc.get(f"/api/v1/posts/by-author/{a['user_id']}?limit=2", headers=ha)
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None

    r2 = await uc.get(
        f"/api/v1/posts/by-author/{a['user_id']}?limit=2&cursor={body['next_cursor']}",
        headers=ha,
    )
    assert r2.status_code == 200
    ids1 = {item["id"] for item in body["items"]}
    ids2 = {item["id"] for item in r2.json()["items"]}
    assert ids1.isdisjoint(ids2)
