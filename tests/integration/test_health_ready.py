"""Integration: /health/ready aggregate policy."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.cache import redis as redis_mod
from social_api.db import session as db_session
from social_api.main import create_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def _client_with_lifespan() -> AsyncClient:
    app = create_app()
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def test_ready_when_both_ok(fake_redis: object) -> None:
    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(db_session, "ping_db", _ok_ping)
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/ready")
                assert r.status_code == 200
                assert r.json()["status"] == "ready"
                assert r.json()["overall"] == "ok"


async def test_degraded_when_only_redis_down() -> None:
    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    async def _bad_ping() -> tuple[bool, float, str | None]:
        return False, 0.5, "ConnectionError"

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(db_session, "ping_db", _ok_ping)
        mp.setattr(redis_mod, "ping_redis", _bad_ping)
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/ready")
                assert r.status_code == 200
                body = r.json()
                assert body["status"] == "degraded"
                assert body["overall"] == "degraded"
                assert body["checks"]["db"]["status"] == "ok"
                assert body["checks"]["redis"]["status"] == "down"


async def test_not_ready_when_db_down() -> None:
    async def _bad_ping() -> tuple[bool, float, str | None]:
        return False, 0.5, "OperationalError"

    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(db_session, "ping_db", _bad_ping)
        mp.setattr(redis_mod, "ping_redis", _ok_ping)
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/ready")
                assert r.status_code == 503
                assert r.json()["status"] == "not_ready"
