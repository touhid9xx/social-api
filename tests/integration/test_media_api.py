"""End-to-end media upload + attach."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app
from tests.conftest import InMemoryStorage

pytestmark = [pytest.mark.integration]

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63000100000005000100"
    "0d0a2db40000000049454e44ae426082"
)


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
) -> AsyncIterator[tuple[AsyncClient, InMemoryStorage]]:
    app = create_app()
    # Override storage with in-memory for test
    from social_api.modules.media.service import get_storage_backend

    mem = InMemoryStorage()
    app.dependency_overrides[get_storage_backend] = lambda: mem

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c, mem


async def test_upload_and_attach_to_post(
    uc: tuple[AsyncClient, InMemoryStorage],
) -> None:
    client, mem = uc
    a = await _login(client, "media-a@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    # Upload PNG
    files = {"file": ("photo.png", PNG_BYTES, "image/png")}
    r = await client.post("/api/v1/media", headers=ha, files=files)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["kind"] == "image"
    assert m["post_id"] is None
    mid = m["id"]
    assert len(mem.objects) == 1

    # Create post
    r = await client.post("/api/v1/posts", headers=ha, json={"body": "with pic"})
    pid = r.json()["id"]

    # Attach
    r = await client.post(f"/api/v1/media/{mid}/attach/{pid}", headers=ha)
    assert r.status_code == 200
    assert r.json()["post_id"] == pid

    # Post now reports media_count=1
    r = await client.get(f"/api/v1/posts/{pid}", headers=ha)
    assert r.json()["media_count"] == 1

    # Dedup: upload same bytes -> same media_id
    files = {"file": ("photo.png", PNG_BYTES, "image/png")}
    r = await client.post("/api/v1/media", headers=ha, files=files)
    assert r.status_code == 201
    assert r.json()["id"] == mid


async def test_upload_unsupported_type_415(
    uc: tuple[AsyncClient, InMemoryStorage],
) -> None:
    client, _ = uc
    a = await _login(client, "media-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    files = {"file": ("note.txt", b"hello world text file", "text/plain")}
    r = await client.post("/api/v1/media", headers=ha, files=files)
    assert r.status_code == 415
    assert r.json()["error"] == "UNSUPPORTED_MEDIA_TYPE"


async def test_set_avatar_from_owned_upload(
    uc: tuple[AsyncClient, InMemoryStorage],
) -> None:
    """An upload becomes the profile picture, and only the owner can do it."""
    client, _ = uc
    a = await _login(client, "avatar-a@example.com")
    b = await _login(client, "avatar-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    files = {"file": ("me.png", PNG_BYTES, "image/png")}
    r = await client.post("/api/v1/media", headers=ha, files=files)
    assert r.status_code == 201, r.text
    media = r.json()

    # The profile starts without a picture, so the assertion below can only pass
    # because of the call under test.
    r = await client.get("/api/v1/users/me", headers=ha)
    assert r.status_code == 200
    assert r.json()["avatar_url"] is None

    r = await client.post(f"/api/v1/media/{media['id']}/avatar", headers=ha)
    assert r.status_code == 200, r.text
    assert r.json()["url"] == media["url"]

    r = await client.get("/api/v1/users/me", headers=ha)
    assert r.json()["avatar_url"] == media["url"]

    # Someone else cannot promote A's image onto their own profile.
    r = await client.post(f"/api/v1/media/{media['id']}/avatar", headers=hb)
    assert r.status_code == 403
    assert r.json()["error"] == "MEDIA_FORBIDDEN"

    # And B's profile was not touched by the failed attempt.
    r = await client.get("/api/v1/users/me", headers=hb)
    assert r.json()["avatar_url"] is None


async def test_attach_foreign_media_forbidden(
    uc: tuple[AsyncClient, InMemoryStorage],
) -> None:
    client, _ = uc
    a = await _login(client, "owner@example.com")
    b = await _login(client, "attacker@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    files = {"file": ("photo.png", PNG_BYTES, "image/png")}
    r = await client.post("/api/v1/media", headers=ha, files=files)
    mid = r.json()["id"]

    r = await client.post("/api/v1/posts", headers=hb, json={"body": "my post"})
    pid = r.json()["id"]

    # B tries to attach A's media -> 403
    r = await client.post(f"/api/v1/media/{mid}/attach/{pid}", headers=hb)
    assert r.status_code == 403
    assert r.json()["error"] == "MEDIA_FORBIDDEN"
