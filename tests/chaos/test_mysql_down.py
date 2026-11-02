"""MySQL outage: 503, readiness fails, recovery after restart."""

from __future__ import annotations

import asyncio
import subprocess

import httpx
import pytest

pytestmark = [pytest.mark.chaos, pytest.mark.asyncio]


BASE = "http://localhost:8000"
# Matches scripts/seed_demo_data.py. Chaos runs against a live stack with no
# way to read the mailed verification link, and /auth/login refuses unverified
# accounts, so these tests sign in as a pre-verified seeded demo user.
DEMO_PASSWORD = "DemoPass123!"


def _docker(*args: str) -> None:
    subprocess.run(["docker", *args], check=False, timeout=30)


async def _login(email: str) -> dict[str, str]:
    async with httpx.AsyncClient(base_url=BASE, timeout=15.0) as c:
        r = await c.post(
            "/api/v1/auth/login",
            json={"email": email, "password": DEMO_PASSWORD},
        )
        return {"access": r.json()["tokens"]["access_token"]}


async def test_mysql_down_readiness_503(require_docker: None) -> None:
    creds = await _login("user02@example.com")
    h = {"Authorization": f"Bearer {creds['access']}"}

    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as c:
        # Baseline
        r = await c.get("/health/ready")
        assert r.status_code == 200

        # Kill mysql
        _docker("stop", "social-mysql")
        try:
            await asyncio.sleep(5)

            # Readiness returns 503 (DB is hard dep)
            r = await c.get("/health/ready")
            assert r.status_code == 503
            body = r.json()
            assert body["status"] == "not_ready"

            # Write path fails
            r = await c.post("/api/v1/posts", headers=h, json={"body": "chaos test"})
            assert r.status_code in (500, 503)
        finally:
            _docker("start", "social-mysql")

            # Wait for MySQL startup + pool reconnect
            await asyncio.sleep(20)

        r = await c.get("/health/ready")
        assert r.status_code == 200

        # Writes recover
        r = await c.post("/api/v1/posts", headers=h, json={"body": "post-recovery"})
        assert r.status_code == 201
