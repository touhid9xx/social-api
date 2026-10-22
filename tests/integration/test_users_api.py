"""End-to-end users API tests."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app

pytestmark = [pytest.mark.integration]


async def _register_and_login(client: AsyncClient, email: str = "u@example.com") -> dict[str, str]:
    pwd = "Str0ng!Passw0rd"
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": pwd})
    assert r.status_code == 201, r.text
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert r.status_code == 200
    tokens = r.json()["tokens"]
    return {
        "access": tokens["access_token"],
        "refresh": tokens["refresh_token"],
        "user_id": str(r.json()["user"]["id"]),
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


async def test_me_returns_own_pii(uc: AsyncClient) -> None:
    t = await _register_and_login(uc, "me@example.com")
    r = await uc.get("/api/v1/users/me", headers={"Authorization": f"Bearer {t['access']}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == int(t["user_id"])
    assert "version" in body
    assert "dob" in body  # even if null, field exists


async def test_public_profile_hides_pii(uc: AsyncClient) -> None:
    owner = await _register_and_login(uc, "owner@example.com")
    # Set some PII
    r = await uc.patch(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {owner['access']}"},
        json={
            "version": 1,
            "display_name": "Owner",
            "dob": "1990-05-15",
            "phone": "+8801700000000",
        },
    )
    assert r.status_code == 200

    # Another user views the profile
    other = await _register_and_login(uc, "other@example.com")
    r = await uc.get(
        f"/api/v1/users/{owner['user_id']}",
        headers={"Authorization": f"Bearer {other['access']}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["display_name"] == "Owner"
    # PII MUST be absent
    for pii_field in ("dob", "phone", "address", "version"):
        assert pii_field not in body


async def test_optimistic_lock_returns_409(uc: AsyncClient) -> None:
    t = await _register_and_login(uc, "lock@example.com")
    r = await uc.get("/api/v1/users/me", headers={"Authorization": f"Bearer {t['access']}"})
    version = r.json()["version"]

    r = await uc.patch(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {t['access']}"},
        json={"version": version, "display_name": "First"},
    )
    assert r.status_code == 200
    new_version = r.json()["version"]
    assert new_version == version + 1

    r = await uc.patch(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {t['access']}"},
        json={"version": version, "display_name": "Stale"},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "VERSION_CONFLICT"
    assert body["detail"]["current_version"] == new_version


async def test_consent_grant_list_revoke(uc: AsyncClient) -> None:
    t = await _register_and_login(uc, "consent@example.com")
    auth = {"Authorization": f"Bearer {t['access']}"}

    r = await uc.get("/api/v1/users/me/consent", headers=auth)
    assert r.json()["consents"] == []

    r = await uc.post(
        "/api/v1/users/me/consent",
        headers=auth,
        json={"channel": "email_marketing"},
    )
    assert r.status_code == 201

    r = await uc.get("/api/v1/users/me/consent", headers=auth)
    assert len(r.json()["consents"]) == 1
    assert r.json()["consents"][0]["channel"] == "email_marketing"
    assert r.json()["consents"][0]["granted"] is True

    r = await uc.delete("/api/v1/users/me/consent/email_marketing", headers=auth)
    assert r.status_code == 204

    r = await uc.get("/api/v1/users/me/consent", headers=auth)
    assert r.json()["consents"] == []


async def test_soft_delete_blocks_reaccess(uc: AsyncClient) -> None:
    t = await _register_and_login(uc, "delete@example.com")
    auth = {"Authorization": f"Bearer {t['access']}"}
    r = await uc.delete("/api/v1/users/me", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert "hard_delete_after" in body

    r = await uc.get("/api/v1/users/me", headers=auth)
    assert r.status_code == 401
