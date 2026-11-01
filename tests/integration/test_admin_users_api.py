"""End-to-end admin account management: PATCH / activate / DELETE /users/{id}.

The unit suite (`tests/unit/test_users_service.py`) covers the service rules
against a fake directory. What only a live app can prove is the wiring:

* the RBAC gate on all four routes (403 for a signed-in non-admin),
* route precedence — `/users/me` must keep winning over `/users/{user_id}`,
* the response is the full `AdminUserView`, re-read after the write,
* a soft delete really removes the account from every read path.

RBAC reads the role claim off the JWT, so promotion needs a re-login.
"""

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

PASSWORD = "Str0ng!Passw0rd"


async def _login(client: AsyncClient, email: str) -> dict[str, str]:
    """Register (or reuse) and login; returns the access token and user id."""
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    if r.status_code not in (201, 409):
        pytest.fail(f"register failed: {r.status_code} {r.text}")

    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"access": body["tokens"]["access_token"], "user_id": str(body["user"]["id"])}


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


async def _admin_headers(client: AsyncClient, email: str) -> dict[str, str]:
    """Register, promote, then re-login so the JWT carries role=ADMIN."""
    await _login(client, email)
    await _promote_to_admin(email)
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    token = r.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _auth(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access']}"}


@pytest_asyncio.fixture()
async def uc(use_testcontainers_db: str, fake_redis: object) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_non_admin_is_denied_on_every_admin_route(uc: AsyncClient) -> None:
    """All four admin routes share require_roles(ADMIN) -> 403 FORBIDDEN."""
    actor = await _login(uc, "adm-nonadmin@example.com")
    target = await _login(uc, "adm-nonadmin-target@example.com")
    h = _auth(actor)

    r = await uc.get("/api/v1/users", headers=h)
    assert r.status_code == 403, r.text
    assert r.json()["error"] == "FORBIDDEN"

    r = await uc.patch(f"/api/v1/users/{target['user_id']}", headers=h, json={"role": "admin"})
    assert r.status_code == 403, r.text

    r = await uc.post(f"/api/v1/users/{target['user_id']}/activate", headers=h)
    assert r.status_code == 403, r.text

    r = await uc.delete(f"/api/v1/users/{target['user_id']}", headers=h)
    assert r.status_code == 403, r.text


async def test_patch_changes_one_field_and_ignores_omitted_ones(uc: AsyncClient) -> None:
    """PATCH is a field write: omitted keys are untouched, `null` means no change."""
    h = await _admin_headers(uc, "adm-patch@example.com")
    target = await _login(uc, "adm-patch-target@example.com")

    r = await uc.patch(f"/api/v1/users/{target['user_id']}", headers=h, json={"role": "moderator"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == int(target["user_id"])
    assert body["role"] == "moderator"
    # Role change alone must not touch the active flag.
    assert body["is_active"] is True

    r = await uc.patch(f"/api/v1/users/{target['user_id']}", headers=h, json={"is_active": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_active"] is False
    assert body["role"] == "moderator"  # unchanged by the second PATCH


async def test_empty_update_is_a_400_not_a_silent_noop(uc: AsyncClient) -> None:
    h = await _admin_headers(uc, "adm-empty@example.com")
    target = await _login(uc, "adm-empty-target@example.com")
    path = f"/api/v1/users/{target['user_id']}"

    r = await uc.patch(path, headers=h, json={})
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "EMPTY_UPDATE"

    # An explicit null is "no change", not "write NULL" (which would be a 500).
    r = await uc.patch(path, headers=h, json={"is_active": None})
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "EMPTY_UPDATE"


async def test_activate_clears_deactivation_and_marks_verified(uc: AsyncClient) -> None:
    """The one action an operator uses to unblock a freshly registered account."""
    h = await _admin_headers(uc, "adm-activate@example.com")
    target = await _login(uc, "adm-activate-target@example.com")
    path = f"/api/v1/users/{target['user_id']}"

    r = await uc.patch(path, headers=h, json={"is_active": False, "is_verified": False})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False

    r = await uc.post(f"{path}/activate", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_active"] is True
    assert body["is_verified"] is True

    # Idempotent: a double click must not be an error.
    r = await uc.post(f"{path}/activate", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True


async def test_admin_cannot_act_on_their_own_account(uc: AsyncClient) -> None:
    """Self-deactivate/demote/delete would lock the operator out of the console."""
    h = await _admin_headers(uc, "adm-self@example.com")

    me = await uc.get("/api/v1/users/me", headers=h)
    my_id = me.json()["user_id"]

    for method, path, payload in (
        ("patch", f"/api/v1/users/{my_id}", {"is_active": False}),
        ("patch", f"/api/v1/users/{my_id}", {"role": "user"}),
        ("post", f"/api/v1/users/{my_id}/activate", None),
        ("delete", f"/api/v1/users/{my_id}", None),
    ):
        r = await uc.request(method, path, headers=h, json=payload)
        assert r.status_code == 403, f"{method} {path}: {r.status_code} {r.text}"
        assert r.json()["error"] == "CANNOT_MODIFY_SELF", f"{method} {path}: {r.text}"

    # The account is intact after all four refusals.
    still = await uc.get("/api/v1/users/me", headers=h)
    assert still.status_code == 200


async def test_delete_is_soft_and_removes_the_account_everywhere(uc: AsyncClient) -> None:
    h = await _admin_headers(uc, "adm-delete@example.com")
    target = await _login(uc, "adm-delete-target@example.com")
    path = f"/api/v1/users/{target['user_id']}"

    r = await uc.delete(path, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == int(target["user_id"])
    assert body["is_active"] is False

    # Gone from the directory...
    r = await uc.get("/api/v1/users", headers=h, params={"limit": 100})
    assert r.status_code == 200, r.text
    ids = [item["id"] for item in r.json()["items"]]
    assert int(target["user_id"]) not in ids

    # ...unreachable by an admin action (404, not a 200 on a deleted row)...
    r = await uc.post(f"{path}/activate", headers=h)
    assert r.status_code == 404, r.text

    # ...and the account itself can no longer authenticate.
    r = await uc.get("/api/v1/users/me", headers=_auth(target))
    assert r.status_code == 401, r.text
    r = await uc.post(
        "/api/v1/auth/login",
        json={"email": "adm-delete-target@example.com", "password": PASSWORD},
    )
    assert r.status_code == 401, r.text


async def test_me_routes_are_not_shadowed_by_admin_routes(uc: AsyncClient) -> None:
    """`/{user_id}` must not swallow `/me` — 'me' is not an int path param.

    An admin is the interesting case because they can reach both paths, so a
    precedence mistake would surface here as a 422 rather than a 403.
    """
    h = await _admin_headers(uc, "adm-me@example.com")

    r = await uc.get("/api/v1/users/me", headers=h)
    assert r.status_code == 200, r.text
    version = r.json()["version"]

    r = await uc.patch(
        "/api/v1/users/me", headers=h, json={"version": version, "display_name": "Self"}
    )
    assert r.status_code == 200, r.text
    my_id = r.json()["user_id"]
    assert r.json()["display_name"] == "Self"

    # The admin's own row in the directory reflects the profile write — the
    # directory and the profile read from the same account row.
    r = await uc.get("/api/v1/users", headers=h, params={"limit": 100})
    assert r.status_code == 200, r.text
    mine = [item for item in r.json()["items"] if item["id"] == my_id]
    assert len(mine) == 1, f"admin missing from own directory: {r.text}"
    assert mine[0]["display_name"] == "Self"
