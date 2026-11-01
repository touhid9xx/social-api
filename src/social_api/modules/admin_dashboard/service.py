"""Admin dashboard aggregates.

One method (`overview`) returns every section so the admin page costs a single
round trip. Every number here is a *bounded* aggregate over an indexed column:

* whole-day windows only (`day`/`created_at >= start`), so MySQL can use the
  leading column of the composite indexes,
* `LIMIT`-ed detail lists (`top_consumers`, `regions`, `by_class`) instead of
  unbounded scans,
* soft-deleted rows excluded everywhere except the explicit `deleted` counter.

Two sections are allowed to *fail* rather than lie:

* `traffic` reports `available=False` when visit analytics is switched off or
  has recorded nothing yet,
* `workers` reports `available=False` when Redis is unreachable.

Both cases would otherwise render as a convincing wall of zeros.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, cast

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.cache.keys import RedisKeys
from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.logging_config import get_logger
from social_api.modules.admin_dashboard.schemas import (
    ContentSummary,
    DailyPoint,
    DashboardOverview,
    PathClassRow,
    RegionRow,
    StorageConsumers,
    StorageSummary,
    TrafficSummary,
    UsersSummary,
    WorkersSummary,
)
from social_api.modules.analytics.models import AnalyticsVisit
from social_api.modules.auth.models import User, UserRole
from social_api.modules.chat.models import ChatRoom, Message
from social_api.modules.comments.models import Comment
from social_api.modules.follows.models import Follow
from social_api.modules.likes.models import Like
from social_api.modules.media.models import Media, MediaKind
from social_api.modules.posts.models import Post
from social_api.modules.users.models import Profile

logger = get_logger(__name__)

# Redis key the Celery worker consumes from. Mirrors
# `workers/tasks/heartbeat.py`, which reports the same number to Prometheus.
_QUEUE_KEY = "celery"

# Detail lists are capped so the response stays a fixed size regardless of
# how much data the instance holds.
_TOP_CONSUMERS = 5
_TOP_REGIONS = 10
_TOP_CLASSES = 12

# Error threshold shared with Prometheus' error-rate alert.
_ERROR_STATUS = 400


def _as_day(value: Any) -> date:
    """Normalize a `date()` group-by key.

    MySQL returns a `date`, SQLite returns the `'YYYY-MM-DD'` string — both
    drivers are supported by the test suite.
    """
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _series(raw: dict[date, int], start_day: date, window_days: int) -> list[DailyPoint]:
    """Zero-fill a sparse day map into a dense series.

    Charts need one point per day; a missing day is a real zero (nothing was
    created), not unknown data. Only *fixed-width* series are filled — the
    traffic series stays sparse and is measured by `requests`.
    """
    return [
        DailyPoint(day=day, value=raw.get(day, 0))
        for day in (start_day + timedelta(days=offset) for offset in range(window_days))
    ]


class DashboardService:
    """Read-only aggregate queries behind `GET /admin/dashboard`."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ---------------------------------------------------------------- helpers

    async def _count(self, stmt: Select[Any]) -> int:
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def _count_where(self, model: type[Any], *where: Any) -> int:
        stmt = select(func.count()).select_from(model)
        if where:
            stmt = stmt.where(*where)
        return await self._count(stmt)

    async def _count_by_day(self, model: type[Any], since: datetime) -> dict[date, int]:
        day_col = func.date(model.created_at)
        stmt = (
            select(day_col, func.count())
            .where(model.created_at >= since, model.deleted_at.is_(None))
            .group_by(day_col)
            .order_by(day_col)
        )
        rows = await self.session.execute(stmt)
        return {_as_day(day): int(count) for day, count in rows.all()}

    # ---------------------------------------------------------------- sections

    async def overview(self, *, window_days: int = 30) -> DashboardOverview:
        """Aggregate every dashboard section for the trailing `window_days`."""
        now = datetime.now(UTC)
        today = now.date()
        start_day = today - timedelta(days=window_days - 1)
        start_dt = datetime.combine(start_day, time.min)
        previous_start_dt = start_dt - timedelta(days=window_days)
        now_naive = now.replace(tzinfo=None)

        return DashboardOverview(
            generated_at=now,
            window_days=window_days,
            users=await self._users(
                start_day=start_day,
                window_days=window_days,
                start_dt=start_dt,
                previous_start_dt=previous_start_dt,
                now=now_naive,
            ),
            content=await self._content(
                start_day=start_day, window_days=window_days, start_dt=start_dt
            ),
            storage=await self._storage(),
            traffic=await self._traffic(start_day=start_day, window_days=window_days),
            workers=await self._workers(),
        )

    async def _users(
        self,
        *,
        start_day: date,
        window_days: int,
        start_dt: datetime,
        previous_start_dt: datetime,
        now: datetime,
    ) -> UsersSummary:
        """Registration and activity counts.

        `total` includes soft-deleted rows (they still consume storage and are
        reported separately as `deleted`); every other counter excludes them.
        """
        live = User.deleted_at.is_(None)

        total = await self._count_where(User)
        deleted = await self._count_where(User, User.deleted_at.is_not(None))
        active = await self._count_where(User, live, User.is_active.is_(True))
        verified = await self._count_where(User, live, User.is_verified.is_(True))
        staff = await self._count_where(
            User, live, User.role.in_((UserRole.MODERATOR, UserRole.ADMIN))
        )
        new_in_window = await self._count_where(User, live, User.created_at >= start_dt)
        new_previous_window = await self._count_where(
            User,
            live,
            User.created_at >= previous_start_dt,
            User.created_at < start_dt,
        )

        active_last_24h = await self._count_where(
            User, live, User.last_login_at >= now - timedelta(days=1)
        )
        active_last_7d = await self._count_where(
            User, live, User.last_login_at >= now - timedelta(days=7)
        )
        active_last_30d = await self._count_where(
            User, live, User.last_login_at >= now - timedelta(days=30)
        )

        return UsersSummary(
            total=total,
            active=active,
            verified=verified,
            staff=staff,
            deleted=deleted,
            new_in_window=new_in_window,
            new_previous_window=new_previous_window,
            active_last_24h=active_last_24h,
            active_last_7d=active_last_7d,
            active_last_30d=active_last_30d,
            signups_by_day=_series(
                await self._count_by_day(User, start_dt), start_day, window_days
            ),
        )

    async def _content(
        self, *, start_day: date, window_days: int, start_dt: datetime
    ) -> ContentSummary:
        """Volume totals plus per-day creation activity."""
        posts = await self._count_where(Post, Post.deleted_at.is_(None))
        comments = await self._count_where(Comment, Comment.deleted_at.is_(None))
        likes = await self._count_where(Like)
        follows = await self._count_where(Follow)
        chat_rooms = await self._count_where(ChatRoom, ChatRoom.deleted_at.is_(None))
        messages = await self._count_where(Message, Message.deleted_at.is_(None))

        posts_in_window = await self._count_where(
            Post, Post.deleted_at.is_(None), Post.created_at >= start_dt
        )
        comments_in_window = await self._count_where(
            Comment, Comment.deleted_at.is_(None), Comment.created_at >= start_dt
        )
        messages_in_window = await self._count_where(
            Message, Message.deleted_at.is_(None), Message.created_at >= start_dt
        )

        # One line that answers "is the site being used, and when?" — posts,
        # comments and messages summed per day.
        per_day: dict[date, int] = {}
        for model in (Post, Comment, Message):
            for day, count in (await self._count_by_day(model, start_dt)).items():
                per_day[day] = per_day.get(day, 0) + count

        return ContentSummary(
            posts=posts,
            comments=comments,
            likes=likes,
            follows=follows,
            chat_rooms=chat_rooms,
            messages=messages,
            posts_in_window=posts_in_window,
            comments_in_window=comments_in_window,
            messages_in_window=messages_in_window,
            activity_by_day=_series(per_day, start_day, window_days),
        )

    async def _storage(self) -> StorageSummary:
        """Media volume from `media.size_bytes`, split by kind and attachment."""
        live = Media.deleted_at.is_(None)

        media_count = await self._count_where(Media, live)
        total_bytes = await self._bytes_where(live)
        users_with_media = await self._count(
            select(func.count(func.distinct(Media.owner_id))).where(live)
        )

        by_kind_stmt = (
            select(Media.kind, func.coalesce(func.sum(Media.size_bytes), 0))
            .where(live)
            .group_by(Media.kind)
        )
        by_kind = {
            kind.value if isinstance(kind, MediaKind) else str(kind): int(size)
            for kind, size in (await self.session.execute(by_kind_stmt)).all()
        }

        # Orphans = uploaded but never attached to a post or a message. These
        # are what the retention worker sweeps and what silently grows a disk.
        orphan = (Media.post_id.is_(None), Media.message_id.is_(None))
        orphan_count = await self._count_where(Media, live, *orphan)
        orphan_bytes = await self._bytes_where(live, *orphan)

        consumers_stmt = (
            select(
                Media.owner_id,
                Profile.display_name,
                func.count(Media.id),
                func.coalesce(func.sum(Media.size_bytes), 0),
            )
            .outerjoin(Profile, Profile.user_id == Media.owner_id)
            .where(live)
            .group_by(Media.owner_id, Profile.display_name)
            .order_by(func.sum(Media.size_bytes).desc())
            .limit(_TOP_CONSUMERS)
        )
        top_consumers = [
            StorageConsumers(
                user_id=int(owner_id),
                display_name=display_name,
                media_count=int(count),
                total_bytes=int(size),
            )
            for owner_id, display_name, count, size in (
                await self.session.execute(consumers_stmt)
            ).all()
        ]

        return StorageSummary(
            media_count=media_count,
            total_bytes=total_bytes,
            image_bytes=by_kind.get(MediaKind.IMAGE.value, 0),
            video_bytes=by_kind.get(MediaKind.VIDEO.value, 0),
            orphan_count=orphan_count,
            orphan_bytes=orphan_bytes,
            users_with_media=users_with_media,
            average_bytes_per_user=total_bytes // users_with_media if users_with_media else 0,
            top_consumers=top_consumers,
        )

    async def _bytes_where(self, *where: Any) -> int:
        stmt = select(func.coalesce(func.sum(Media.size_bytes), 0))
        if where:
            stmt = stmt.where(*where)
        return await self._count(stmt)

    async def _traffic(self, *, start_day: date, window_days: int) -> TrafficSummary:
        """Windowed request telemetry from `analytics_visit`."""
        settings = get_settings()
        empty = TrafficSummary(
            available=False,
            requests=0,
            authenticated_requests=0,
            unique_visitors=0,
            error_requests=0,
            error_rate=0.0,
            avg_latency_ms=0.0,
            p95_latency_ms=0,
            requests_by_day=[],
            by_class=[],
            regions=[],
        )
        if not settings.analytics_enabled:
            return empty

        window = AnalyticsVisit.day >= start_day
        weight = AnalyticsVisit.weight

        totals_stmt = select(
            func.coalesce(func.sum(weight), 0),
            func.coalesce(func.sum(case((AnalyticsVisit.is_authenticated, weight), else_=0)), 0),
            func.coalesce(
                func.sum(case((AnalyticsVisit.status_code >= _ERROR_STATUS, weight), else_=0)), 0
            ),
            func.coalesce(func.sum(AnalyticsVisit.latency_ms * weight), 0),
            func.count(),
        ).where(window)
        requests, authenticated, errors, latency_sum, rows = (
            await self.session.execute(totals_stmt)
        ).one()
        requests = int(requests)
        if requests == 0 and int(rows) == 0:
            return empty

        total_weight = int(requests) or int(rows) or 1
        avg_latency = round(int(latency_sum) / total_weight, 2)

        by_day_stmt = (
            select(AnalyticsVisit.day, func.coalesce(func.sum(weight), 0))
            .where(window)
            .group_by(AnalyticsVisit.day)
            .order_by(AnalyticsVisit.day)
        )
        requests_by_day = [
            DailyPoint(day=_as_day(day), value=int(value))
            for day, value in (await self.session.execute(by_day_stmt)).all()
        ]

        by_class_stmt = (
            select(
                AnalyticsVisit.path_class,
                func.coalesce(func.sum(weight), 0).label("requests"),
                func.coalesce(
                    func.sum(case((AnalyticsVisit.status_code >= _ERROR_STATUS, weight), else_=0)),
                    0,
                ),
                func.coalesce(func.avg(AnalyticsVisit.latency_ms), 0),
            )
            .where(window)
            .group_by(AnalyticsVisit.path_class)
            .order_by(func.sum(weight).desc())
            .limit(_TOP_CLASSES)
        )
        by_class = [
            PathClassRow(
                path_class=str(path_class),
                requests=int(class_requests),
                error_requests=int(class_errors),
                avg_latency_ms=round(float(class_latency), 2),
            )
            for path_class, class_requests, class_errors, class_latency in (
                await self.session.execute(by_class_stmt)
            ).all()
        ]

        regions_stmt = (
            select(
                AnalyticsVisit.country,
                AnalyticsVisit.city,
                AnalyticsVisit.timezone,
                func.coalesce(func.sum(weight), 0).label("requests"),
            )
            .where(window)
            .group_by(AnalyticsVisit.country, AnalyticsVisit.city, AnalyticsVisit.timezone)
            .order_by(func.sum(weight).desc())
            .limit(_TOP_REGIONS)
        )
        # Shares are of *all* windowed requests, including unresolved ones, so
        # the listed rows intentionally do not sum to 1.0.
        regions = [
            RegionRow(
                country=country,
                city=city,
                timezone=timezone,
                requests=int(region_requests),
                share=round(int(region_requests) / total_weight, 4),
            )
            for country, city, timezone, region_requests in (
                await self.session.execute(regions_stmt)
            ).all()
        ]

        return TrafficSummary(
            available=True,
            requests=requests,
            authenticated_requests=int(authenticated),
            unique_visitors=await self._unique_visitors(start_day, window_days),
            error_requests=int(errors),
            error_rate=round(int(errors) / total_weight, 4),
            avg_latency_ms=avg_latency,
            p95_latency_ms=await self._p95_latency(window),
            requests_by_day=requests_by_day,
            by_class=by_class,
            regions=regions,
        )

    async def _p95_latency(self, window: Any) -> int:
        """95th percentile latency via an ordered offset.

        MySQL 8 has no `PERCENTILE_CONT`, and pulling every latency into Python
        would defeat the point of aggregating in SQL — so pick the single row at
        the 95% rank instead.
        """
        rows = await self._count(select(func.count()).select_from(AnalyticsVisit).where(window))
        if rows == 0:
            return 0
        offset = max(0, math.ceil(rows * 0.95) - 1)
        stmt = (
            select(AnalyticsVisit.latency_ms)
            .where(window)
            .order_by(AnalyticsVisit.latency_ms)
            .offset(offset)
            .limit(1)
        )
        return await self._count(stmt)

    async def _unique_visitors(self, start_day: date, window_days: int) -> int:
        """Approximate distinct visitors from the per-day Redis HyperLogLog sets."""
        keys = [
            RedisKeys.analytics_unique_visitors((start_day + timedelta(days=offset)).isoformat())
            for offset in range(window_days)
        ]
        try:
            value = await cast(Awaitable[int], get_redis().pfcount(*keys))
            return int(value)
        except Exception as exc:
            logger.debug("analytics_uv_unavailable", error=type(exc).__name__)
            return 0

    async def _workers(self) -> WorkersSummary:
        """Celery broker depth straight from Redis."""
        try:
            depth = await cast(Awaitable[int], get_redis().llen(_QUEUE_KEY))
            return WorkersSummary(available=True, queue_depth=int(depth))
        except Exception as exc:
            logger.debug("queue_depth_unavailable", error=type(exc).__name__)
            return WorkersSummary(available=False, queue_depth=0)
