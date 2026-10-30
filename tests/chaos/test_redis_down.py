"""Redis outage: feed falls back to DB, breaker opens, graceful recovery."""

from __future__ import annotations

import asyncio
import subprocess

import httpx
import pytest

pytestmark = [pytest.mark.chaos, pytest.mark.asyncio]


BASE = "http://localhost:8000"
PWD = "Str0ng!Passw0rd"


def _docker(*args: str) -> None:
    subprocess.run(["docker", *args], check=False, timeout=30)


async def _login(email: str) -> dict[str, str]:
    async with httpx.AsyncClient(base_url=BASE, timeout=15.0) as c:
        await c.post(
            "/api/v1/auth/register",
            json={"email": email, "password": PWD},
        )
        r = await c.post(
            "/api/v1/auth/login",
            json={"email": email, "password": PWD},
        )
        return {"access": r.json()["tokens"]["access_token"]}


async def test_redis_down_graceful(require_docker: None) -> None:
    creds = await _login("chaos-redis@test.com")
    h = {"Authorization": f"Bearer {creds['access']}"}

    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as c:
        # Baseline
        r = await c.get("/api/v1/feed/home", headers=h)
        assert r.status_code == 200

        # Kill redis
        _docker("stop", "social-redis")
        try:
            await asyncio.sleep(2)  # Redis container fully stopped

            # Feed still works (DB fallback)
            r = await c.get("/api/v1/feed/home", headers=h)
            assert r.status_code == 200, r.text

            # Health degraded but not 503 (Redis is soft dep)
            r = await c.get("/health/ready")
            assert r.status_code == 200
            assert r.json()["status"] in {"degraded", "ready"}

            # Write still works
            r = await c.post("/api/v1/posts", headers=h, json={"body": "chaos test"})
            assert r.status_code == 201

            # After 5+ failed attempts, breaker should be OPEN
            for _ in range(10):
                await c.get("/api/v1/feed/home", headers=h)
            # Query /metrics for breaker state
            r = await c.get("/metrics")
            assert 'circuit_breaker_state{name="redis"} 2.0' in r.text, (
                "breaker should be OPEN after sustained failures"
            )
        finally:
            _docker("start", "social-redis")

        # Wait for Redis up
        await asyncio.sleep(8)

        # Recovery: after recovery_timeout (30s), probe closes breaker
        await asyncio.sleep(32)

        r = await c.get("/api/v1/feed/home", headers=h)
        assert r.status_code == 200

        # Health ready
        r = await c.get("/health/ready")
        assert r.status_code == 200
        assert r.json()["status"] == "ready"
