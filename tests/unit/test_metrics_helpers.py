"""Metric helper presence + WS/breaker gauges registered."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit


def test_metrics_registered() -> None:
    from social_api.observability import metrics as m

    for name in (
        "feed_generation_seconds",
        "feed_cache_hits",
        "feed_cache_misses",
        "posts_created_total",
        "likes_total",
        "comments_total",
        "notifications_created_total",
        "chat_messages_total",
        "report_created_total",
        "audit_rows_written_total",
        "circuit_breaker_state",
        "websocket_connections_active",
        "websocket_connect_total",
        "websocket_disconnect_total",
        "celery_tasks_total",
        "celery_queue_depth",
        "db_pool_checkedout",
        "db_pool_overflow",
    ):
        assert hasattr(m, name), f"missing metric {name}"


def test_ws_connect_counter_labeled() -> None:
    from social_api.observability.metrics import websocket_connect_total

    websocket_connect_total.labels(result="success").inc()
    # No exception means label registered


def test_ws_disconnect_counter_labeled() -> None:
    from social_api.observability.metrics import websocket_disconnect_total

    websocket_disconnect_total.labels(reason="client").inc()
    websocket_disconnect_total.labels(reason="timeout").inc()
    websocket_disconnect_total.labels(reason="error").inc()
    websocket_disconnect_total.labels(reason="server_shutdown").inc()


def test_celery_task_counter_labeled() -> None:
    from social_api.observability.metrics import celery_tasks_total

    celery_tasks_total.labels(task="t", status="success").inc()
