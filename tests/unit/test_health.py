"""Health probes: liveness, readiness, per-dependency, security headers."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from social_api.observability import health as health_mod

pytestmark = pytest.mark.unit

PingResult = tuple[bool, float, str | None]
PingFn = Callable[[], Awaitable[PingResult]]


# ---------------------------------------------------------------------------
# /health — liveness
# ---------------------------------------------------------------------------
async def test_health_liveness(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "Social API"
    assert body["version"] == "0.1.0"
    assert body["env"] in {"development", "staging", "production"}
    assert "X-Request-ID" in r.headers
    assert "X-Process-Time-Ms" in r.headers


# ---------------------------------------------------------------------------
# /health/ready — aggregate readiness
# ---------------------------------------------------------------------------
async def test_readiness_ready_when_all_ok(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _ok() -> PingResult:
        return True, 0.5, None

    # Patch at usage site in health.py (from-import bindings).
    monkeypatch.setattr(health_mod, "ping_db", _ok)
    monkeypatch.setattr(health_mod, "ping_redis", _ok)

    r = await client.get("/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"
    assert body["overall"] == "ok"
    assert body["checks"]["db"]["status"] == "ok"
    assert body["checks"]["redis"]["status"] == "ok"


async def test_readiness_degraded_when_redis_down(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _ok() -> PingResult:
        return True, 0.5, None

    async def _bad() -> PingResult:
        return False, 0.5, "ConnectionError"

    monkeypatch.setattr(health_mod, "ping_db", _ok)
    monkeypatch.setattr(health_mod, "ping_redis", _bad)

    r = await client.get("/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["overall"] == "degraded"
    assert body["checks"]["redis"]["status"] == "down"
    assert body["checks"]["redis"]["error"] == "ConnectionError"


async def test_readiness_not_ready_when_db_down(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _ok() -> PingResult:
        return True, 0.5, None

    async def _bad() -> PingResult:
        return False, 0.5, "OperationalError"

    monkeypatch.setattr(health_mod, "ping_db", _bad)
    monkeypatch.setattr(health_mod, "ping_redis", _ok)

    r = await client.get("/health/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "not_ready"
    assert body["overall"] == "down"
    assert body["checks"]["db"]["status"] == "down"


# ---------------------------------------------------------------------------
# /health/db and /health/redis
# ---------------------------------------------------------------------------
async def test_health_db_ok(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok() -> PingResult:
        return True, 2.5, None

    monkeypatch.setattr(health_mod, "ping_db", _ok)

    r = await client.get("/health/db")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["latency_ms"] == 2.5


async def test_health_db_down(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _bad() -> PingResult:
        return False, 10.0, "OperationalError"

    monkeypatch.setattr(health_mod, "ping_db", _bad)

    r = await client.get("/health/db")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "down"
    assert body["error"] == "OperationalError"


async def test_health_redis_ok(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok() -> PingResult:
        return True, 0.4, None

    monkeypatch.setattr(health_mod, "ping_redis", _ok)

    r = await client.get("/health/redis")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_health_redis_down(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _bad() -> PingResult:
        return False, 5.0, "ConnectionError"

    monkeypatch.setattr(health_mod, "ping_redis", _bad)

    r = await client.get("/health/redis")
    assert r.status_code == 503
    assert r.json()["status"] == "down"


# ---------------------------------------------------------------------------
# Root + headers + error shape
# ---------------------------------------------------------------------------
async def test_root_endpoint(client: AsyncClient) -> None:
    r = await client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["docs"] == "/docs"
    assert body["openapi"] == "/openapi.json"
    assert body["health"] == "/health"


async def test_security_headers(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"


async def test_404_error_shape(client: AsyncClient) -> None:
    r = await client.get("/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["status"] == 404
    assert body["path"] == "/does-not-exist"
    assert "error" in body
    assert "request_id" in body
    assert body["request_id"] == r.headers["X-Request-ID"]


async def test_i18n_demo(client: AsyncClient) -> None:
    r = await client.get("/_i18n_demo", headers={"Accept-Language": "bn-BD"})
    assert r.status_code == 200
    body = r.json()
    assert body["en"] == "Service is healthy"
    assert body["bn"] == "সার্ভিস সচল আছে"
    assert body["requested"] == "সার্ভিস সচল আছে"
