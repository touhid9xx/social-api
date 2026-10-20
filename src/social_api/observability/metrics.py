"""Prometheus metrics (auto + custom)."""

from __future__ import annotations

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

# Module-level flag: only instrument once per Python process.
# Prevents duplicate metric registration when multiple FastAPI() instances are
# created in the same process (pytest, uvicorn --reload, embedded).
_INSTRUMENTED = False


def setup_metrics(app: FastAPI) -> Instrumentator:
    """
    Attach prometheus-fastapi-instrumentator to /metrics.

    Idempotent per process: subsequent calls with new app instances skip the
    instrument/expose step (metrics are already registered globally). Custom
    counters are registered in later milestones (M21).
    """
    global _INSTRUMENTED

    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_respect_env_var=False,
        should_instrument_requests_inprogress=True,
        excluded_handlers=["/metrics", "/health", "/health/ready"],
        inprogress_name="http_requests_inprogress",
        inprogress_labels=True,
    )

    if not _INSTRUMENTED:
        instrumentator.instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
        _INSTRUMENTED = True

    return instrumentator


def reset_metrics_for_tests() -> None:
    """Test-only hook: clear the guard so the next create_app() re-instruments."""
    global _INSTRUMENTED
    _INSTRUMENTED = False
