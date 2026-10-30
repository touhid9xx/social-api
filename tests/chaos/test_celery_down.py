"""Celery worker outage: writes succeed, queue grows, drains on recovery."""

from __future__ import annotations

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


async def test_celery_down_queue_buildup(require_docker: None) -> None:
    """
    Requires a Celery worker container. This test is designed for
    prod-compose stack (`docker compose -f docker-compose.prod.yml`).
    If worker container name doesn't match, adapt the docker stop arg.
    """
    pytest.skip(
        "Chaos test for Celery requires named worker container — "
        "run manually against prod-compose after starting worker. "
        "See README for manual chaos procedure."
    )
