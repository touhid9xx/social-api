"""`analytics_visit` — one row per sampled request, reduced to non-identifying facts.

Deliberately *not* a soft-deleted entity: retention is a hard `DELETE` older
than `settings.analytics_retention_days`, because holding "deleted" analytics
rows forever would defeat the point of retention.
"""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base


class PathClass(enum.StrEnum):
    """Coarse bucket for a request path.

    Stored as a plain `String(16)` rather than a DB enum so a new bucket is
    an additive code change with no migration. `classify_path` is the single
    place that maps an arbitrary path onto one of these.
    """

    AUTH = "auth"
    FEED = "feed"
    POSTS = "posts"
    COMMENTS = "comments"
    MEDIA = "media"
    CHAT = "chat"
    SEARCH = "search"
    PROFILE = "profile"
    NOTIFICATIONS = "notifications"
    ADMIN = "admin"
    OTHER = "other"


class AnalyticsVisit(Base):
    """A single recorded request.

    Privacy contract: every column below is either a bucket, a number, or a
    coarse location. Nothing here identifies a person or links two rows to
    the same person.
    """

    __tablename__ = "analytics_visit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # UTC calendar day. All dashboard windows are expressed in whole days.
    day: Mapped[date] = mapped_column(Date, nullable=False)
    path_class: Mapped[str] = mapped_column(String(16), nullable=False)
    # True when the request carried a valid access token. Still non-identifying.
    is_authenticated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("0")
    )

    status_code: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    # GeoLite2 City, when the offline DB + `geoip2` are available. NULL else.
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # round(1 / analytics_sample_rate). Absolute counts are SUM(weight) so
    # lowering the sample rate scales the estimates instead of destroying them.
    weight: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # `day` leads both composites, so it needs no index of its own.
        Index("ix_analytics_visit_day_class", "day", "path_class"),
        Index("ix_analytics_visit_day_country", "day", "country"),
    )

    def __repr__(self) -> str:
        return (
            f"<AnalyticsVisit day={self.day} class={self.path_class} "
            f"status={self.status_code} country={self.country}>"
        )
