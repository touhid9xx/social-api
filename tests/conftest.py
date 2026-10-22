"""Shared pytest fixtures.

Strategy:
  - Unit tests: no DB, no Redis (fast).
  - Integration tests (marked `integration`): real MySQL via testcontainers,
    Redis via fakeredis (unless TEST_REDIS_URL set).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from social_api.cache import redis as redis_mod
from social_api.config import get_settings
from social_api.main import create_app


@pytest.fixture(scope="session", autouse=True)
def _settings() -> None:
    get_settings.cache_clear()


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Integration: MySQL via testcontainers
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def _mysql_container() -> Iterator[Any]:
    """Session-scoped MySQL container. Skipped if testcontainers unavailable."""
    try:
        from testcontainers.mysql import MySqlContainer
    except ImportError:  # pragma: no cover
        pytest.skip("testcontainers not installed")

    with MySqlContainer(
        "mysql:8.0", username="social", password="socialpass", dbname="social"
    ) as mysql:
        yield mysql


@pytest.fixture(scope="session")
def integration_db_url(_mysql_container: Any) -> str:
    """DATABASE_URL pointing to the testcontainers MySQL."""
    host = _mysql_container.get_container_host_ip()
    port = _mysql_container.get_exposed_port(3307)
    return f"mysql+asyncmy://social:socialpass@{host}:{port}/social?charset=utf8mb4"


@pytest.fixture
def use_testcontainers_db(monkeypatch: pytest.MonkeyPatch, integration_db_url: str) -> str:
    """Point settings at the testcontainers DB and reset the engine."""
    from social_api.db import session as db_session

    monkeypatch.setenv("DATABASE_URL", integration_db_url)
    get_settings.cache_clear()

    # Reset engine so next init_engine() uses new URL
    if db_session._engine is not None:
        asyncio.get_event_loop().run_until_complete(db_session.dispose_engine())
    return integration_db_url


# ---------------------------------------------------------------------------
# Integration: Redis via fakeredis
# ---------------------------------------------------------------------------
@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Patch the Redis client with a fakeredis async instance."""
    import fakeredis.aioredis

    server = fakeredis.FakeServer()
    fake = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)
    yield fake
    # cleanup
    monkeypatch.setattr(redis_mod, "_client", None, raising=False)
