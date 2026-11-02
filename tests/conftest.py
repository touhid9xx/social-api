"""Shared pytest fixtures.

Strategy:
  - Unit tests: no DB, no Redis (fast).
  - Integration tests (marked `integration`):
      * MySQL: TEST_DB_URL env if set (points at your local
        `social-mysql` container on 3307), else testcontainers
        with a TCP-ping wait strategy (see _wait_for_tcp).
      * Redis: fakeredis unless TEST_REDIS_URL set.
"""

from __future__ import annotations

import asyncio as _asyncio
import contextlib
import hashlib
import os
import re
import socket
import time
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from social_api.cache import redis as redis_mod
from social_api.config import get_settings
from social_api.main import create_app
from social_api.media.storage import StoredObject


@pytest.fixture(scope="session", autouse=True)
def _settings() -> None:
    os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "true")
    get_settings.cache_clear()


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest_asyncio.fixture()
async def client(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncClient]:
    from social_api.observability import health as health_mod

    async def _ok() -> tuple[bool, float, str | None]:
        return True, 0.1, None

    monkeypatch.setattr(health_mod, "ping_db", _ok)
    monkeypatch.setattr(health_mod, "ping_redis", _ok)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Integration: MySQL (TEST_DB_URL fast path OR testcontainers fallback)
# ---------------------------------------------------------------------------


def _wait_for_tcp(host: str, port: int, timeout: float = 180.0) -> None:
    """Poll TCP accept until MySQL's port is live or timeout hits."""
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=2.0):
                return
        except OSError as exc:
            last_err = exc
            time.sleep(0.5)
    raise TimeoutError(f"MySQL at {host}:{port} not ready within {timeout}s: {last_err}")


@pytest.fixture(scope="session")
def _mysql_container() -> Iterator[Any]:
    """Session-scoped MySQL. Skipped if unavailable or TEST_DB_URL is set."""
    if os.environ.get("TEST_DB_URL"):
        yield None
        return

    try:
        from testcontainers.community.mysql import MySqlContainer
    except ImportError:  # pragma: no cover
        pytest.skip("testcontainers not installed")

    container = MySqlContainer(
        "mysql:8.0",
        username="social",
        password="socialpass",
        dbname="social",
    )
    with container as mysql:
        host = mysql.get_container_host_ip()
        port = int(mysql.get_exposed_port(3306))
        _wait_for_tcp(host, port, timeout=180.0)
        yield mysql


@pytest.fixture(scope="session")
def integration_db_url(_mysql_container: Any) -> str:
    """DATABASE_URL for integration tests."""
    env_url = os.environ.get("TEST_DB_URL")
    if env_url:
        return env_url

    host = _mysql_container.get_container_host_ip()
    port = int(_mysql_container.get_exposed_port(3306))
    return f"mysql+asyncmy://social:socialpass@{host}:{port}/social?charset=utf8mb4"


@pytest.fixture(scope="session", autouse=True)
def _clean_test_db(request: pytest.FixtureRequest) -> None:
    """Truncate every user-data table once per session (except alembic_version).

    The ``integration_db_url`` fixture is resolved lazily (not as a declared
    dependency) so that unit-only test sessions never start a MySQL container.
    """
    has_integration = any(
        item.get_closest_marker("integration") is not None for item in request.session.items
    )
    if not has_integration:
        return

    integration_db_url = request.getfixturevalue("integration_db_url")

    try:
        from sqlalchemy import text
        from sqlalchemy.ext.asyncio import create_async_engine
    except ImportError:  # pragma: no cover
        return

    async def _truncate() -> None:
        engine = create_async_engine(integration_db_url, pool_pre_ping=True)
        try:
            async with engine.begin() as conn:
                await conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
                result = await conn.execute(
                    text(
                        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                        "WHERE TABLE_SCHEMA = DATABASE()"
                    )
                )
                for (table,) in result.fetchall():
                    if table == "alembic_version":
                        continue
                    await conn.execute(text(f"TRUNCATE TABLE `{table}`"))
                await conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
        finally:
            await engine.dispose()

    try:
        _asyncio.run(_truncate())
    except Exception as exc:  # pragma: no cover
        print(f"[conftest] _clean_test_db skipped: {exc!r}")


@pytest_asyncio.fixture
async def use_testcontainers_db(
    monkeypatch: pytest.MonkeyPatch, integration_db_url: str
) -> AsyncIterator[str]:
    """Point settings at the test DB URL and reset the engine."""
    from social_api.db import session as db_session

    monkeypatch.setenv("DATABASE_URL", integration_db_url)
    get_settings.cache_clear()

    await db_session.dispose_engine()

    try:
        yield integration_db_url
    finally:
        await db_session.dispose_engine()
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Integration: Redis via fakeredis
# ---------------------------------------------------------------------------
@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    """Patch the Redis client with a fakeredis async instance."""
    import fakeredis.aioredis

    server = fakeredis.FakeServer()
    fake = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)
    yield fake
    monkeypatch.setattr(redis_mod, "_client", None, raising=False)


# ---------------------------------------------------------------------------
# Rate limit isolation
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _disable_rate_limit() -> Iterator[None]:
    try:
        from social_api.core.rate_limit import limiter
    except ImportError:  # pragma: no cover
        yield
        return

    strategy = getattr(limiter, "limiter", None)
    if strategy is None:  # pragma: no cover — unexpected slowapi shape
        yield
        return

    original_hit = strategy.hit

    def _always_allow(*args: Any, **kwargs: Any) -> bool:
        return True

    strategy.hit = _always_allow
    try:
        yield
    finally:
        strategy.hit = original_hit


# ---------------------------------------------------------------------------
# Fake storage backend for tests
# ---------------------------------------------------------------------------
class InMemoryStorage:
    """In-memory StorageBackend for fast tests."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    async def put(self, *, key: str, data: bytes, content_type: str) -> StoredObject:
        self.objects[key] = data
        self.content_types[key] = content_type
        return StoredObject(key=key, size_bytes=len(data), url=f"mem://{key}")

    async def delete(self, *, key: str) -> None:
        self.objects.pop(key, None)
        self.content_types.pop(key, None)

    async def url_for(self, *, key: str) -> str:
        return f"mem://{key}"


@pytest.fixture
def mem_storage() -> InMemoryStorage:
    return InMemoryStorage()


# ---------------------------------------------------------------------------
# Prometheus registry isolation
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Prometheus registry isolation
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _reset_prometheus_registry() -> None:
    from prometheus_client import REGISTRY

    _m: Any = None
    with contextlib.suppress(ImportError):
        from social_api.observability import metrics as _m

    saved: list[Any] = []
    if _m is not None:
        for name in dir(_m):
            obj = getattr(_m, name)
            if hasattr(obj, "_name") and hasattr(obj, "_labelnames"):
                saved.append(obj)

    with REGISTRY._lock:
        REGISTRY._names_to_collectors.clear()
        with contextlib.suppress(AttributeError):
            REGISTRY._collector_to_names.clear()

    for collector in saved:
        with contextlib.suppress(Exception):
            REGISTRY.register(collector)


# ---------------------------------------------------------------------------
# Outbound mail capture + the verification step every session needs
# ---------------------------------------------------------------------------

_VERIFICATION_TOKEN_RE = re.compile(r"token=([\w\-.]+)")

_SENT: list[dict[str, str]] = []


@pytest.fixture(autouse=True)
def _capture_email(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[dict[str, str]]]:
    """Record dispatched mail instead of touching SMTP / Celery.

    Autouse so no test can accidentally attempt a real send, and the single
    capture every helper below reads. Modules that assert on the mail itself
    (``test_email_verification.py``, ``test_password_reset.py``) take the
    ``outbox`` fixture rather than patching ``dispatch_email`` a second time —
    a later patch would silently redirect the mail away from ``_SENT`` and
    break ``verification_token_for``.
    """
    _SENT.clear()

    async def _capture(*, to: str, subject: str, body: str) -> None:
        _SENT.append({"to": to, "subject": subject, "body": body})

    from social_api.modules.auth import service as auth_service_mod

    monkeypatch.setattr(auth_service_mod, "dispatch_email", _capture)
    try:
        yield _SENT
    finally:
        _SENT.clear()


@pytest.fixture
def outbox(_capture_email: list[dict[str, str]]) -> list[dict[str, str]]:
    """The mail captured for this test — cleared before every test."""
    return _capture_email


def verification_token_for(email: str) -> str:
    """Pull the one-time token out of the verification mail sent to ``email``."""
    for message in reversed(_SENT):
        if message["to"] != email:
            continue
        match = _VERIFICATION_TOKEN_RE.search(message["body"])
        if match is not None:
            return match.group(1)
    raise AssertionError(f"no verification email was captured for {email}")


def _verified_register_outcome(status_code: int, email: str) -> str | None:
    """Decide what a ``POST /auth/register`` reply means for the caller.

    Returns the token to consume, or ``None`` when there is nothing to do.
    A ``409`` means an earlier test already created the row: ask for a fresh
    link (sent only while the account is still unverified) so the second
    caller converges on the same verified state instead of failing.
    """
    if status_code == 201:
        return verification_token_for(email)
    if status_code == 409:
        return None
    raise AssertionError(f"register failed with {status_code}")


async def register_verified(client: AsyncClient, email: str, password: str) -> None:
    """Register an account, then consume the link the app would have mailed.

    ``register`` leaves ``is_verified`` False and ``/auth/login`` answers
    ``403 EMAIL_NOT_VERIFIED`` to an unverified account, so any test that wants
    a session has to walk the same path a real user does: register, open the
    emailed link, then sign in. Sending itself is captured by
    ``_capture_email`` — nothing leaves the process.
    """
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    token = _verified_register_outcome(r.status_code, email)
    if token is None:
        before = len(_SENT)
        await client.post("/api/v1/auth/resend-verification", json={"email": email})
        if len(_SENT) == before:  # already verified — no mail was owed
            return
        token = verification_token_for(email)
    r = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text


async def _user_id_for(email: str) -> int:
    """Resolve a user id by email hash, for callers that hold no session."""
    from sqlalchemy import select

    from social_api.db.session import get_sessionmaker
    from social_api.modules.auth.models import User

    email_hash = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    sm = get_sessionmaker()
    async with sm() as session:
        found = await session.scalar(select(User.id).where(User.email_hash == email_hash))
    if found is None:
        raise AssertionError(f"no user row for {email}")
    return int(found)


async def register_unverified(client: AsyncClient, email: str, password: str) -> int:
    """Register an account *without* consuming the mailed link; return its id.

    The admin ``verify`` and ``resend-verification`` flows only mean anything
    for an address that has not been confirmed, and they address the account by
    id rather than email — so this returns the id from the ``201`` body instead
    of trading it for a session the way ``register_verified`` does.
    """
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    if r.status_code == 201:
        return int(r.json()["user"]["id"])
    if r.status_code == 409:  # an earlier caller already created the row
        return await _user_id_for(email)
    raise AssertionError(f"register failed with {r.status_code}: {r.text}")


def register_verified_sync(client: TestClient, email: str, password: str) -> None:
    """``register_verified`` for the sync ``TestClient`` WebSocket suites."""
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    token = _verified_register_outcome(r.status_code, email)
    if token is None:
        before = len(_SENT)
        client.post("/api/v1/auth/resend-verification", json={"email": email})
        if len(_SENT) == before:
            return
        token = verification_token_for(email)
    r = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert r.status_code == 200, r.text
