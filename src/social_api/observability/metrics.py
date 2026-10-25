"""Prometheus metrics (auto + custom)."""

from __future__ import annotations

import contextlib

from fastapi import FastAPI
from prometheus_client import REGISTRY, Counter, Histogram
from prometheus_fastapi_instrumentator import Instrumentator

# ---------------------------------------------------------------------------
# Custom metrics (module-level; registered once at import)
# ---------------------------------------------------------------------------
feed_generation_seconds = Histogram(
    "feed_generation_duration_seconds",
    "Time to generate a feed page",
    labelnames=["type"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

feed_cache_hits = Counter(
    "feed_cache_hits_total",
    "Home feed cache hits",
    labelnames=["type"],
)

feed_cache_misses = Counter(
    "feed_cache_misses_total",
    "Home feed cache misses",
    labelnames=["type"],
)

posts_created_total = Counter("posts_created_total", "Total posts created")
likes_total = Counter("likes_total", "Total likes")
comments_total = Counter("comments_total", "Total comments")

explore_generation_seconds = Histogram(
    "explore_generation_duration_seconds",
    "Time to generate an explore feed page",
    labelnames=["type"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

trending_score_histogram = Histogram(
    "trending_score_value",
    "Distribution of computed trending scores",
    buckets=(0.01, 0.1, 1.0, 5.0, 20.0, 100.0, 500.0, 2000.0),
)
# ---------------------------------------------------------------------------
# Auto-instrumentation (idempotent — safe to call setup_metrics() many times)
# ---------------------------------------------------------------------------

# Names that the Instrumentator registers on the default REGISTRY.
# Kept explicit so we only ever unregister OUR collectors (never custom
# metrics added later, e.g. in M21).
_INSTRUMENTATOR_COLLECTOR_NAMES: frozenset[str] = frozenset(
    {
        "http_requests_total",
        "http_requests_inprogress",
        "http_request_duration_seconds",
        "http_request_size_bytes",
        "http_response_size_bytes",
    }
)


def _unregister_instrumentator_metrics() -> None:
    """Drop instrumentator collectors from the default REGISTRY.

    Why: ``prometheus_client``'s default REGISTRY is a process-wide singleton
    and raises ``DuplicateTimeseries`` on the second registration of the same
    metric name. Tests call ``create_app()`` (and therefore
    ``setup_metrics()``) many times in one process. Unregistering our own
    collectors first makes ``setup_metrics()`` idempotent.

    We use the private ``_collector_to_names`` mapping because the public API
    only exposes ``REGISTRY.unregister(collector)`` — it needs the collector
    object itself, which we don't have a handle on otherwise.
    """
    for collector, names in list(REGISTRY._collector_to_names.items()):
        if _INSTRUMENTATOR_COLLECTOR_NAMES & set(names):
            with contextlib.suppress(KeyError):
                REGISTRY.unregister(collector)


def setup_metrics(app: FastAPI) -> Instrumentator:
    """Instrument ``app`` with Prometheus middleware + expose ``/metrics``.

    Idempotent: repeated calls in the same process (tests) will not raise
    ``DuplicateTimeseries``. In production this is only ever called once.
    """
    _unregister_instrumentator_metrics()

    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_respect_env_var=False,
        should_instrument_requests_inprogress=True,
        excluded_handlers=[
            "/metrics",
            "/health",
            "/health/ready",
            "/health/db",
            "/health/redis",
        ],
        inprogress_name="http_requests_inprogress",
        inprogress_labels=True,
    )
    instrumentator.instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    return instrumentator
