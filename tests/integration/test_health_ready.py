"""Integration: /health/ready aggregate policy."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.main import create_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_ready_when_both_ok(fake_redis: object) -> None:
    """Both probes succeed → status=ready, overall=ok.

    Patches health_mod.ping_db / health_mod.ping_redis so the test is
    hermetic: no dependency on real MySQL availability. fake_redis binds
    the Redis client to the current loop.
    """
    from social_api.observability import health as health_mod

    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(health_mod, "ping_db", _ok_ping)
        mp.setattr(health_mod, "ping_redis", _ok_ping)
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/ready")
                assert r.status_code == 200
                body = r.json()
                assert body["status"] == "ready"
                assert body["overall"] == "ok"


async def test_degraded_when_only_redis_down(fake_redis: object) -> None:
    """DB up, Redis down → degraded (200 + body hint)."""
    from social_api.observability import health as health_mod

    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    async def _bad_ping() -> tuple[bool, float, str | None]:
        return False, 0.5, "ConnectionError"

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(health_mod, "ping_db", _ok_ping)
        mp.setattr(health_mod, "ping_redis", _bad_ping)
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


async def test_not_ready_when_db_down(fake_redis: object) -> None:
    """DB down → 503 (SLO broken, LB stops routing)."""
    from social_api.observability import health as health_mod

    async def _bad_ping() -> tuple[bool, float, str | None]:
        return False, 0.5, "OperationalError"

    async def _ok_ping() -> tuple[bool, float, str | None]:
        return True, 0.5, None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(health_mod, "ping_db", _bad_ping)
        mp.setattr(health_mod, "ping_redis", _ok_ping)
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get("/health/ready")
                assert r.status_code == 503
                assert r.json()["status"] == "not_ready"
