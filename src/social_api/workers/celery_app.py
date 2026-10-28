"""Celery application configured with Redis broker/backend.

Windows: always run worker with `-P solo` (no fork support).

    celery -A social_api.workers.celery_app worker -l info -P solo
    celery -A social_api.workers.celery_app beat -l info   # scheduled jobs
"""

from __future__ import annotations

from typing import Any

from celery import Celery
from celery.schedules import crontab
from celery.signals import task_failure, task_retry, task_success

from social_api.config import get_settings
from social_api.logging_config import get_logger

settings = get_settings()

celery_app = Celery(
    "social_api",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "social_api.workers.tasks.feed_fanout",
        "social_api.workers.tasks.trending",
        "social_api.workers.tasks.retention",
        "social_api.workers.tasks.heartbeat",
        "social_api.workers.tasks.idempotency_cleanup",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=60,
    task_soft_time_limit=50,
    task_acks_late=True,  # ack after run, safer on worker crash
    worker_prefetch_multiplier=4,  # pipelining, but don't hog
    task_default_queue="default",
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,  # surface task exceptions in tests
    broker_connection_retry_on_startup=True,
)

celery_app.conf.beat_schedule = {
    "refresh-explore-zset": {
        "task": "feed.refresh_explore_zset",
        "schedule": 300.0,  # every 5 minutes
    },
    # Retention jobs
    "purge-soft-deleted-users": {
        "task": "retention.purge_users",
        "schedule": crontab(hour=2, minute=0),  # daily 02:00 UTC
    },
    "purge-old-notifications": {
        "task": "retention.purge_notifications",
        "schedule": crontab(hour=3, minute=0),  # daily 03:00 UTC
    },
    "purge-orphan-media": {
        "task": "retention.purge_orphan_media",
        "schedule": crontab(hour=5, minute=0),  # daily 05:00 UTC
    },
    "purge-old-audit": {
        "task": "retention.purge_audit",
        "schedule": crontab(hour=4, minute=0, day_of_week=0),  # Sun 04:00
    },
    "purge-read-messages": {
        "task": "retention.purge_read_messages",
        "schedule": crontab(hour=6, minute=0, day_of_week=0),  # Sun 06:00
    },
    "emit-queue-depth": {
        "task": "metrics.emit_queue_depth",
        "schedule": 30.0,  # every 30s
    },
    "cleanup-idempotency": {
        "task": "idempotency.cleanup",
        "schedule": crontab(hour=4, minute=30),  # daily 04:30 UTC
    },
}


logger = get_logger(__name__)


def _task_metric(task_name: str, status: str) -> None:
    try:
        from social_api.observability.metrics import celery_tasks_total

        celery_tasks_total.labels(task=task_name, status=status).inc()
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug(
            "celery_task_metric_failed",
            task_name=task_name,
            status=status,
            error=type(exc).__name__,
        )


@task_success.connect
def _on_task_success(sender: Any = None, **_kw: object) -> None:
    if sender is not None:
        _task_metric(getattr(sender, "name", "unknown"), "success")


@task_failure.connect
def _on_task_failure(sender: Any = None, **_kw: object) -> None:
    if sender is not None:
        _task_metric(getattr(sender, "name", "unknown"), "failure")


@task_retry.connect
def _on_task_retry(sender: Any = None, **_kw: object) -> None:
    if sender is not None:
        _task_metric(getattr(sender, "name", "unknown"), "retry")
