"""Moderation models."""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin


class ReportTargetType(enum.StrEnum):
    POST = "post"
    COMMENT = "comment"
    USER = "user"
    MESSAGE = "message"


class ReportReason(enum.StrEnum):
    SPAM = "spam"
    ABUSE = "abuse"
    HARASSMENT = "harassment"
    OTHER = "other"


class ReportStatus(enum.StrEnum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


TERMINAL_STATUSES: frozenset[ReportStatus] = frozenset(
    {ReportStatus.RESOLVED, ReportStatus.DISMISSED}
)


class Report(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reporter_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_type: Mapped[ReportTargetType] = mapped_column(
        Enum(ReportTargetType, name="report_target_type"), nullable=False
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[ReportReason] = mapped_column(
        Enum(ReportReason, name="report_reason"), nullable=False
    )
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, name="report_status"),
        nullable=False,
        default=ReportStatus.OPEN,
    )
    reviewer_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    day_bucket: Mapped[date] = mapped_column(Date, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index(
            "uq_reports_dedupe",
            "reporter_id",
            "target_type",
            "target_id",
            "day_bucket",
            unique=True,
        ),
        Index("ix_reports_status_created", "status", "created_at"),
        Index("ix_reports_target", "target_type", "target_id"),
        Index("ix_reports_reporter", "reporter_id"),
        Index("ix_reports_deleted_at", "deleted_at"),
        CheckConstraint(
            "length(details) <= 5000 OR details IS NULL",
            name="ck_reports_details_len",
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<Report id={self.id} target={self.target_type.value}:"
            f"{self.target_id} status={self.status.value}>"
        )
