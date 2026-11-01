"""Admin dashboard response schemas.

One endpoint returns the whole overview so the page costs a single round
trip. Every section is a plain aggregate — no entity views, no PII beyond a
display name for the top storage consumers.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class DailyPoint(BaseModel):
    """One day of a time series. Days with no rows are omitted, not zero-filled."""

    day: date
    value: int


class UsersSummary(BaseModel):
    """Registration and activity counts derived from `users` / `last_login_at`."""

    total: int
    active: int
    verified: int
    staff: int
    deleted: int
    new_in_window: int
    new_previous_window: int
    active_last_24h: int
    active_last_7d: int
    active_last_30d: int
    signups_by_day: list[DailyPoint]


class ContentSummary(BaseModel):
    """Volume plus the last N days of posting/commenting/messaging activity."""

    posts: int
    comments: int
    likes: int
    follows: int
    chat_rooms: int
    messages: int
    posts_in_window: int
    comments_in_window: int
    messages_in_window: int
    activity_by_day: list[DailyPoint]


class StorageConsumers(BaseModel):
    """A single heavy media owner."""

    user_id: int
    display_name: str | None
    media_count: int
    total_bytes: int


class StorageSummary(BaseModel):
    """Media volume from `media.size_bytes`, split by kind and attachment state."""

    media_count: int
    total_bytes: int
    image_bytes: int
    video_bytes: int
    orphan_count: int
    orphan_bytes: int
    users_with_media: int
    average_bytes_per_user: int
    top_consumers: list[StorageConsumers]


class RegionRow(BaseModel):
    """Where requests came from. Country is ISO-3166 alpha-2, NULL when unresolved."""

    country: str | None
    city: str | None
    timezone: str | None
    requests: int
    share: float = Field(description="Fraction of windowed requests, 0..1")


class PathClassRow(BaseModel):
    """Per endpoint-family traffic: volume, errors and latency."""

    path_class: str
    requests: int
    error_requests: int
    avg_latency_ms: float


class TrafficSummary(BaseModel):
    """Aggregate request telemetry.

    `available` is False when visit analytics is disabled or empty — the
    dashboard renders a "no data yet" state instead of a wall of zeros.
    """

    available: bool
    requests: int
    authenticated_requests: int
    unique_visitors: int
    error_requests: int
    error_rate: float
    avg_latency_ms: float
    p95_latency_ms: int
    requests_by_day: list[DailyPoint]
    by_class: list[PathClassRow]
    regions: list[RegionRow]


class WorkersSummary(BaseModel):
    """Celery broker depth, read straight from Redis.

    `available` is False when Redis could not be reached; the panel then shows
    "unknown" rather than a misleading zero.
    """

    available: bool
    queue_depth: int


class DashboardOverview(BaseModel):
    """Everything the admin dashboard needs, in one response."""

    generated_at: datetime
    window_days: int
    users: UsersSummary
    content: ContentSummary
    storage: StorageSummary
    traffic: TrafficSummary
    workers: WorkersSummary
