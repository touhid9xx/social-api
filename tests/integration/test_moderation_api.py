"""End-to-end moderation flow."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from social_api.main import create_app
from social_api.modules.auth.models import User, UserRole

pytestmark = [pytest.mark.integration]


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    pwd = "Str0ng!Passw0rd"
    await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": pwd},
    )
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


async def _promote_to_moderator(email: str) -> None:
    """Promote a user to moderator directly in DB (test helper)."""
    from social_api.db.session import get_sessionmaker

    sm = get_sessionmaker()
    async with sm() as session:
        stmt = (
            update(User)
            .where(User.email_hash == hashlib.sha256(email.lower().encode()).hexdigest())
            .values(role=UserRole.MODERATOR)
        )
        await session.execute(stmt)
        await session.commit()


async def test_report_flow(uc: AsyncClient) -> None:
    """A creates post, B reports it, A (promoted) resolves the report.

    Reporter ≠ resolver — A is the post author AND the resolving moderator,
    B is the reporter. Clean separation of duties for the test.
    """
    a = await _login(uc, "rep-a@example.com")
    b = await _login(uc, "rep-b@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}
    hb = {"Authorization": f"Bearer {b['access']}"}

    # A creates a post.
    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "spammy"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    # B reports A's post.
    r = await uc.post(
        "/api/v1/moderation/reports",
        headers=hb,
        json={
            "target_type": "post",
            "target_id": pid,
            "reason": "spam",
        },
    )
    assert r.status_code == 201, r.text
    report = r.json()
    assert report["status"] == "open"
    rid = report["id"]

    # A (still a normal user) cannot list reports.
    r = await uc.get("/api/v1/moderation/reports", headers=ha)
    assert r.status_code == 403, r.text

    # Promote A to moderator, re-login for a fresh JWT with the new role.
    await _promote_to_moderator("rep-a@example.com")
    r = await uc.post(
        "/api/v1/auth/login",
        json={
            "email": "rep-a@example.com",
            "password": "Str0ng!Passw0rd",
        },
    )
    assert r.status_code == 200, r.text
    mod_token = r.json()["tokens"]["access_token"]
    hm = {"Authorization": f"Bearer {mod_token}"}

    # A lists reports — must contain B's report.
    r = await uc.get("/api/v1/moderation/reports", headers=hm)
    assert r.status_code == 200
    assert any(item["id"] == rid for item in r.json()["items"])

    # A resolves the report.
    r = await uc.patch(
        f"/api/v1/moderation/reports/{rid}",
        headers=hm,
        json={
            "status": "resolved",
            "version": 1,
            "resolution_note": "handled",
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"
    assert r.json()["resolved_at"] is not None


async def test_self_report_blocked(uc: AsyncClient) -> None:
    """A user cannot report their own content."""
    a = await _login(uc, "selfrep@example.com")
    ha = {"Authorization": f"Bearer {a['access']}"}

    r = await uc.post("/api/v1/posts", headers=ha, json={"body": "mine"})
    assert r.status_code == 201
    pid = r.json()["id"]

    r = await uc.post(
        "/api/v1/moderation/reports",
        headers=ha,
        json={
            "target_type": "post",
            "target_id": pid,
            "reason": "spam",
        },
    )
    assert r.status_code == 400
    assert r.json()["error"] == "CANNOT_REPORT_SELF"
