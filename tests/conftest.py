"""Shared pytest fixtures."""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from social_api.config import Settings, get_settings
from social_api.main import create_app

# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------


def make_settings(**overrides: Any) -> Settings:
    """
    Build a `Settings` instance isolated from the .env file.

    pydantic-settings accepts `_env_file`, `_env_prefix`, etc. at runtime, but
    its `BaseSettings.__init__` is typed as `**values: Any`, so Pyright/Pylance
    flags those keywords as "unknown parameters" — a known typing gap in
    pydantic-settings. This helper centralizes the call so tests stay clean
    under Pyright, and mypy still validates the *field* types via the
    pydantic.mypy plugin.
    """
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


@pytest.fixture(scope="session", autouse=True)
def _settings() -> None:
    """Ensure settings are loaded with test-safe defaults."""
    get_settings.cache_clear()


def _clear_prometheus_registry() -> None:
    """Clear all prometheus collectors and reset the instrumentator guard."""
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


@pytest.fixture(autouse=True)
def _reset_prometheus_registry() -> None:
    """Remove all collectors before each test so instrumentation is idempotent."""
    _clear_prometheus_registry()


# ---------------------------------------------------------------------------
# App + HTTP client
# ---------------------------------------------------------------------------


@pytest.fixture
def app() -> FastAPI:
    """Fresh app instance per test (isolation)."""
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
