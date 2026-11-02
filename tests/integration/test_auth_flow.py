"""End-to-end auth flow against testcontainers MySQL + fakeredis."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app
from tests.conftest import register_verified, verification_token_for

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def auth_client(
    use_testcontainers_db: str,
    fake_redis: object,
) -> AsyncIterator[AsyncClient]:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_register_login_me_logout_flow(auth_client: AsyncClient) -> None:
    email = "alice@example.com"
    password = "Str0ng!Passw0rd"

    # 1. Register
    r = await auth_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["role"] == "user"
    # No PII in response
    assert "email" not in body["user"]
    assert "password" not in body["user"]

    # 2. Duplicate register -> 409
    r = await auth_client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 409
    assert r.json()["error"] == "EMAIL_ALREADY_REGISTERED"

    # 3. Login wrong password -> 401. The password is checked before the
    # verification gate, so a wrong password never reveals account state.
    r = await auth_client.post(
        "/api/v1/auth/login", json={"email": email, "password": "Wrong!12345678"}
    )
    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_CREDENTIALS"

    # 3b. Correct password but unverified -> 403 (not 401: a 401 would make
    # the client try to refresh a session that was never issued).
    r = await auth_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 403, r.text
    assert r.json()["error"] == "EMAIL_NOT_VERIFIED"

    # 3c. Open the emailed link, which is what unblocks sign-in.
    r = await auth_client.post(
        "/api/v1/auth/verify-email", json={"token": verification_token_for(email)}
    )
    assert r.status_code == 200, r.text

    # 4. Login correct -> tokens
    r = await auth_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    tokens = r.json()["tokens"]
    access = tokens["access_token"]
    refresh = tokens["refresh_token"]
    assert tokens["token_type"] == "Bearer"

    # 5. /me works with access
    r = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200
    assert r.json()["role"] == "user"

    # 6. Refresh rotates tokens
    r = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 200, r.text
    new_tokens = r.json()
    assert new_tokens["refresh_token"] != refresh

    # 7. Old refresh rejected now
    r = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401
    assert r.json()["error"] in {"TOKEN_REVOKED", "INVALID_TOKEN"}

    # 8. Logout blacklists access
    r = await auth_client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 204

    # 9. /me with logged-out access -> 401
    r = await auth_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 401


async def test_weak_password_rejected(auth_client: AsyncClient) -> None:
    r = await auth_client.post(
        "/api/v1/auth/register", json={"email": "x@y.com", "password": "short"}
    )
    assert r.status_code == 422
    assert r.json()["error"] == "VALIDATION_ERROR"


async def test_me_without_token(auth_client: AsyncClient) -> None:
    r = await auth_client.get("/api/v1/auth/me")
    assert r.status_code == 401


async def test_change_password_requires_current_password(auth_client: AsyncClient) -> None:
    """`POST /auth/change-password` rotates the password and kills the caller's token."""
    email = "carol@example.com"
    password = "Str0ng!Passw0rd"
    new_password = "An0ther!Passw0rd"

    await register_verified(auth_client, email, password)

    r = await auth_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    access = r.json()["tokens"]["access_token"]
    auth = {"Authorization": f"Bearer {access}"}
    body = {"current_password": password, "new_password": new_password}

    # 1. No bearer token -> 401. The endpoint needs a session, not just a password.
    r = await auth_client.post("/api/v1/auth/change-password", json=body)
    assert r.status_code == 401

    # 2. A weak new password is refused by the shared policy validator.
    r = await auth_client.post(
        "/api/v1/auth/change-password",
        headers=auth,
        json={"current_password": password, "new_password": "short"},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "VALIDATION_ERROR"

    # 3. Wrong current password -> the same INVALID_CREDENTIALS a failed login gives.
    r = await auth_client.post(
        "/api/v1/auth/change-password",
        headers=auth,
        json={"current_password": "Wr0ng!Passw0rd", "new_password": new_password},
    )
    assert r.status_code == 401
    assert r.json()["error"] == "INVALID_CREDENTIALS"

    # 4. Correct current password -> 200, message only (no tokens are minted).
    r = await auth_client.post("/api/v1/auth/change-password", headers=auth, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["message"]
    assert "access_token" not in r.json()

    # 5. The credential that performed the change is blacklisted.
    r = await auth_client.get("/api/v1/auth/me", headers=auth)
    assert r.status_code == 401

    # 6. The old password no longer signs in; the new one does.
    r = await auth_client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 401
    r = await auth_client.post(
        "/api/v1/auth/login", json={"email": email, "password": new_password}
    )
    assert r.status_code == 200, r.text
