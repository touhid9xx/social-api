"""E2E idempotency: retry same key, same body, single post created."""

from __future__ import annotations

import uuid
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
    return {"access": body["tokens"]["access_token"]}


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_retry_same_key_single_post(uc: AsyncClient) -> None:
    a = await _login(uc, "idem-a@example.com")
    h = {"Authorization": f"Bearer {a['access']}"}
    key = str(uuid.uuid4())

    r1 = await uc.post(
        "/api/v1/posts",
        headers={**h, "Idempotency-Key": key},
        json={"body": "hi"},
    )
    assert r1.status_code == 201
    pid = r1.json()["id"]

    r2 = await uc.post(
        "/api/v1/posts",
        headers={**h, "Idempotency-Key": key},
        json={"body": "hi"},
    )
    assert r2.status_code == 201
    assert r2.headers.get("Idempotent-Replay") == "true"
    assert r2.json()["id"] == pid

    # Only 1 post exists for the user
    r = await uc.get("/api/v1/posts/by-author/", headers=h)  # placeholder
    # Use auth/me id
    me = (await uc.get("/api/v1/auth/me", headers=h)).json()
    r = await uc.get(f"/api/v1/posts/by-author/{me['id']}", headers=h)
    assert len([p for p in r.json()["items"] if p["id"] == pid]) == 1


async def test_same_key_different_body_conflict(uc: AsyncClient) -> None:
    a = await _login(uc, "idem-b@example.com")
    h = {"Authorization": f"Bearer {a['access']}"}
    key = str(uuid.uuid4())

    r = await uc.post(
        "/api/v1/posts",
        headers={**h, "Idempotency-Key": key},
        json={"body": "hi"},
    )
    assert r.status_code == 201

    r = await uc.post(
        "/api/v1/posts",
        headers={**h, "Idempotency-Key": key},
        json={"body": "different"},
    )
    assert r.status_code == 409
    assert r.json()["error"] == "IDEMPOTENCY_KEY_CONFLICT"


async def test_no_key_no_idempotency(uc: AsyncClient) -> None:
    a = await _login(uc, "idem-c@example.com")
    h = {"Authorization": f"Bearer {a['access']}"}

    r1 = await uc.post("/api/v1/posts", headers=h, json={"body": "x"})
    r2 = await uc.post("/api/v1/posts", headers=h, json={"body": "x"})
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["id"] != r2.json()["id"]  # two different posts
