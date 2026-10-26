"""Celery application configured with Redis broker/backend.

Windows: always run worker with `-P solo` (no fork support).

    celery -A social_api.workers.celery_app worker -l info -P solo
    celery -A social_api.workers.celery_app beat -l info   # scheduled jobs
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from social_api.config import get_settings

settings = get_settings()

celery_app = Celery(
    "social_api",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "social_api.workers.tasks.feed_fanout",
        "social_api.workers.tasks.trending",
        "social_api.workers.tasks.retention",
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
}
