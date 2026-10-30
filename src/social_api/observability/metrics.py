"""Prometheus metrics (auto + custom)."""

from __future__ import annotations

from fastapi import FastAPI
from prometheus_client import Counter, Gauge, Histogram
from prometheus_fastapi_instrumentator import Instrumentator

# ---- Feed (M9) ----
feed_generation_seconds = Histogram(
    "feed_generation_duration_seconds",
    "Time to generate a feed page",
    labelnames=["type"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)
feed_cache_hits = Counter("feed_cache_hits_total", "Feed cache hits", labelnames=["type"])
feed_cache_misses = Counter("feed_cache_misses_total", "Feed cache misses", labelnames=["type"])

# ---- Business ----
posts_created_total = Counter("posts_created_total", "Total posts created")
likes_total = Counter("likes_total", "Total likes")
comments_total = Counter("comments_total", "Total comments")
notifications_created_total = Counter(
    "notifications_created_total",
    "Notifications created",
    labelnames=["type"],
)
chat_messages_total = Counter(
    "chat_messages_total",
    "Chat messages sent",
    labelnames=["room_type"],
)
report_created_total = Counter(
    "report_created_total",
    "Moderation reports created",
    labelnames=["target_type", "reason"],
)
audit_rows_written_total = Counter(
    "audit_rows_written_total",
    "Audit log rows written",
    labelnames=["action"],
)

# ---- Outbound messaging (email / SMS) ----
outbound_message_total = Counter(
    "outbound_message_total",
    "Outbound transactional messages",
    # `result` values: sent, failed, skipped, enqueue_failed.
    labelnames=["channel", "result"],
)

# ---- Circuit breakers (M20) ----
circuit_breaker_state = Gauge(
    "circuit_breaker_state",
    "Circuit breaker state (0=closed, 1=half_open, 2=open)",
    labelnames=["name"],
)

# ---- WebSocket (M21) ----
websocket_connections_active = Gauge(
    "websocket_connections_active", "Active WebSocket connections (this worker)"
)
websocket_connect_total = Counter(
    "websocket_connect_total",
    "WS connect attempts",
    labelnames=["result"],  # success | auth_fail | rate_limited | feature_off
)
websocket_disconnect_total = Counter(
    "websocket_disconnect_total",
    "WS disconnects",
    labelnames=["reason"],  # client | timeout | error | server_shutdown
)

# ---- Celery (M21) ----
celery_tasks_total = Counter(
    "celery_tasks_total",
    "Celery task completions",
    labelnames=["task", "status"],  # success | failure | retry
)
celery_queue_depth = Gauge("celery_queue_depth", "Approximate message count in default queue")

# ---- DB pool (M21) ----
db_pool_checkedout = Gauge(
    "db_pool_checkedout", "SQLAlchemy pool: currently checked out connections"
)
db_pool_overflow = Gauge("db_pool_overflow", "SQLAlchemy pool: overflow connections in use")


def setup_metrics(app: FastAPI) -> Instrumentator:
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
            "/health/circuit-breakers",
        ],
        inprogress_name="http_requests_inprogress",
        inprogress_labels=True,
    )
    instrumentator.instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    return instrumentator
