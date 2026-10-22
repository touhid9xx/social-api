"""Integration: /health/db against real MySQL (testcontainers)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.db import session as db_session
from social_api.main import create_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_health_db_ok_against_real_mysql(
    use_testcontainers_db: str,
) -> None:
    # Fresh app with lifespan so init_engine runs
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
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "mysql+asyncmy://nobody:bad@127.0.0.1:1/nonexistent",
    )
    from social_api.config import get_settings

    get_settings.cache_clear()

    await db_session.dispose_engine()  # ensure fresh

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/health/db")
            assert r.status_code == 503
            body = r.json()
            assert body["status"] == "down"
            assert "error" in body
