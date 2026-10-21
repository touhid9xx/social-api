"""M0 smoke tests: health + i18n + PII redaction."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.unit


async def test_health_liveness(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "X-Request-ID" in r.headers
    assert "X-Process-Time-Ms" in r.headers


async def test_readiness_ok_in_m0(client: AsyncClient) -> None:
    # M0: /health/ready returns static "ready" (DB/Redis checks land in M3)
    r = await client.get("/health/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ready"


async def test_root_endpoint(client: AsyncClient) -> None:
    r = await client.get("/")
    assert r.status_code == 200
    assert r.json()["docs"] == "/docs"


async def test_i18n_demo(client: AsyncClient) -> None:
    r = await client.get("/_i18n_demo", headers={"Accept-Language": "bn-BD"})
    assert r.status_code == 200
    body = r.json()
    assert body["en"] == "Service is healthy"
    assert body["bn"] == "সার্ভিস সচল আছে"
    assert body["requested"] == "সার্ভিস সচল আছে"


async def test_security_headers(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"


async def test_404_error_shape(client: AsyncClient) -> None:
    r = await client.get("/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["status"] == 404
    assert body["path"] == "/does-not-exist"
    assert "error" in body
    assert "request_id" in body
