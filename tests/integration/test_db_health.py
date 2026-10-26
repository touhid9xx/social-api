"""Integration: /health/db against real MySQL (testcontainers)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.db import session as db_session
from social_api.main import create_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_health_db_ok_against_real_mysql(
    use_testcontainers_db: str,
    fake_redis: object,
) -> None:
    """OK against real MySQL.

    fake_redis binds the Redis client to the current event loop, so
    close_redis() in lifespan teardown doesn't try to aclose() a client
    that belongs to a prior test's (now-dead) loop.
    """
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/health/db")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "ok"
            assert body["latency_ms"] >= 0


async def test_health_db_down_when_bad_url(
    monkeypatch: pytest.MonkeyPatch,
    fake_redis: object,
) -> None:
    """Point DATABASE_URL at a non-existent host → /health/db reports down.

    Two guards needed:

      1. fake_redis: binds Redis to the current loop. Without it,
         close_redis() in lifespan teardown tries to aclose() a Redis
         client that was created in a prior test's event loop →
         RuntimeError: Event loop is closed.

      2. finally block restores DATABASE_URL. monkeypatch restores the
         env var itself, but get_settings() caches; clear it here so the
         next test sees the real DATABASE_URL. Also dispose the bad
         engine so a stale pool doesn't linger.
    """
    monkeypatch.setenv(
        "DATABASE_URL",
        "mysql+asyncmy://nobody:bad@127.0.0.1:1/nonexistent",
    )
    from social_api.config import get_settings

    get_settings.cache_clear()
    await db_session.dispose_engine()

    try:
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/db")
                assert r.status_code == 503
                body = r.json()
                assert body["status"] == "down"
                assert "error" in body
    finally:
        # Restore real DATABASE_URL for subsequent tests.
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()
        await db_session.dispose_engine()
