"""Shared pytest fixtures."""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from social_api.config import get_settings
from social_api.main import create_app

# ---------------------------------------------------------------------------
# Settings — one-time session bootstrap
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _settings() -> None:
    """Ensure settings are loaded with test-safe defaults."""
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Prometheus global registry hygiene
#
# prometheus_client keeps a process-wide CollectorRegistry. Every new
# Instrumentator(app) re-registers the same metric names → DuplicateTimeseries
# on the 2nd app instance. We clear the registry before each test so each
# test's app can re-register cleanly.
#
# Also resets the module-level guard in observability.metrics so instrument()
# runs again on the new app instance (see metrics.py).
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_prometheus_registry() -> Iterator[None]:
    """Remove all collectors before each test so instrumentation is idempotent."""
    from prometheus_client import REGISTRY

    # Clear all registered collectors (private attr — no public clear API exists)
    collectors = REGISTRY._names_to_collectors  # type: ignore[attr-defined]
    for name in list(collectors):
        with contextlib.suppress(KeyError):
            REGISTRY.unregister(collectors[name])

    # Reset the "already instrumented?" guard so the next create_app() re-wires.
    with contextlib.suppress(ImportError):
        from social_api.observability.metrics import reset_metrics_for_tests

        reset_metrics_for_tests()

    yield


# ---------------------------------------------------------------------------
# App + HTTP client
# ---------------------------------------------------------------------------


@pytest.fixture()
def app() -> FastAPI:
    """Fresh app instance per test (isolation)."""
    return create_app()


@pytest.fixture()
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
