"""End-to-end audit flow: login + delete produce rows; filters work."""

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


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    pwd = "Str0ng!Passw0rd"
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


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_my_audit_logs(uc: AsyncClient) -> None:
    a = await _login(uc, "audit-a@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    # Create a post and delete it (produces DELETE_POST).
    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "temp"})
    pid = r.json()["id"]
    await uc.delete(f"/api/v1/posts/{pid}", headers=ha)

    # List own audit.
    r = await uc.get("/api/v1/audit/me", headers=ha)
    assert r.status_code == 200
    items = r.json()["items"]
    actions = [it["action"] for it in items]
    assert "REGISTER" in actions
    assert "LOGIN" in actions
    assert "DELETE_POST" in actions


async def test_admin_can_list_all(uc: AsyncClient) -> None:
    # Register the admin — pre-promotion token is discarded; we re-login
    # after promotion to get a fresh JWT carrying role=ADMIN (RBAC reads
    # the JWT role claim, not the DB).
    await _login(uc, "audit-admin@example.com")
    b = await _login(uc, "audit-user@example.com")
    hb = {"Authorization": f"Bearer {b['access']}"}

    # B does an action to produce audit rows.
    await uc.post("/api/v1/posts", headers=hb, json={"body": "hi"})

    await _promote_to_admin("audit-admin@example.com")
    r = await uc.post(
        "/api/v1/auth/login",
        json={
            "email": "audit-admin@example.com",
            "password": "Str0ng!Passw0rd",
        },
    )
    admin_token = r.json()["tokens"]["access_token"]
    hadmin = {"Authorization": f"Bearer {admin_token}"}

    r = await uc.get("/api/v1/audit", headers=hadmin)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) > 0


async def test_non_admin_denied(uc: AsyncClient) -> None:
    a = await _login(uc, "audit-nonadmin@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    r = await uc.get("/api/v1/audit", headers=ha)
    assert r.status_code == 403, r.text


async def test_audit_never_leaks_pii(uc: AsyncClient) -> None:
    """Audit trail records field NAMES, never VALUES.

    The design choice is deliberate: PII (phone, dob) must never appear
    in audit JSON — only the fact that those fields changed. This test
    verifies both sides of that invariant: field names ARE present, and
    values ARE NOT present, even for non-PII fields like display_name.
    """
    a = await _login(uc, "audit-pii@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    # Update profile with a mix of non-PII (display_name) and PII (phone,
    # dob) fields.
    r = await uc.get("/api/v1/users/me", headers=ha)
    version = r.json()["version"]
    await uc.patch(
        "/api/v1/users/me",
        headers=ha,
        json={
            "version": version,
            "display_name": "Alice",
            "phone": "+8801700000000",
            "dob": "1990-05-15",
        },
    )

    # Read audit — verify the "field names only" invariant.
    r = await uc.get("/api/v1/audit/me", headers=ha)
    assert r.status_code == 200
    raw = r.text

    # PII values NEVER appear (hard guarantee).
    assert "+8801700000000" not in raw
    assert "1990-05-15" not in raw

    # Non-PII values ALSO never appear — this is stricter than strictly
    # required, but audit stores field names only for consistency.
    assert "Alice" not in raw

    # Field names DO appear — that's how forensic queries can answer
    # "did the user change their phone on date X?"
    assert "display_name" in raw
    assert "phone" in raw
    assert "dob" in raw
