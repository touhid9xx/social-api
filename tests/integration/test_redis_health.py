"""Integration: /health/redis with fakeredis (fast, no real Redis needed)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from social_api.cache import redis as redis_mod
from social_api.main import create_app

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def test_health_redis_ok(fake_redis: object) -> None:
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/health/redis")
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "ok"
            assert body["latency_ms"] >= 0


async def test_health_redis_down_when_ping_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _BrokenRedis:
        async def ping(self) -> bool:
            raise ConnectionError("nope")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(redis_mod, "_client", _BrokenRedis(), raising=False)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/health/redis")
            assert r.status_code == 503
            body = r.json()
            assert body["status"] == "down"
            assert body["error"] == "ConnectionError"
