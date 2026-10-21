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

    pydantic-settings accepts `_env_file`, `_env_prefix`, etc. at runtime.
    This helper centralizes the call so tests stay clean under Pyright/Pylance.
    """
    return Settings(_env_file=None, **overrides)


@pytest.fixture(scope="session", autouse=True)
def _settings() -> None:
    """Ensure settings are loaded with test-safe defaults."""
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Prometheus global registry hygiene
# ---------------------------------------------------------------------------


def _clear_prometheus_registry() -> None:
    """Clear all prometheus collectors and reset the instrumentator guard."""
    from prometheus_client import REGISTRY

    collectors = REGISTRY._names_to_collectors
    for name in list(collectors):
        with contextlib.suppress(KeyError):
            REGISTRY.unregister(collectors[name])

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
