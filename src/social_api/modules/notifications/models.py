"""Notification model."""

from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin


class NotificationType(enum.StrEnum):
    FOLLOW = "follow"
    LIKE_POST = "like_post"
    LIKE_COMMENT = "like_comment"
    COMMENT_POST = "comment_post"
    COMMENT_REPLY = "comment_reply"
    # Staff-only: a new account registered and is waiting for manual review.
    # Recipients are admins, the actor is the freshly registered user.
    ADMIN_NEW_USER = "admin_new_user"


class NotificationTargetType(enum.StrEnum):
    USER = "user"
    POST = "post"
    COMMENT = "comment"


class Notification(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="Recipient",
    )
    actor_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        comment="Who triggered it",
    )
    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notification_type"), nullable=False
    )
    target_type: Mapped[NotificationTargetType] = mapped_column(
        Enum(NotificationTargetType, name="notification_target_type"),
        nullable=False,
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    # Dedupe bucket: YYYY-MM-DD. Prevents notification spam for same actor/target.
    day_bucket: Mapped[date] = mapped_column(Date, nullable=False)
    # Optional textual preview (comment excerpt etc.) — never contains PII
    preview: Mapped[str | None] = mapped_column(String(200), nullable=True)

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
            "uq_notifications_dedupe",
            "user_id",
            "actor_id",
            "type",
            "target_type",
            "target_id",
            "day_bucket",
            unique=True,
        ),
        Index("ix_notifications_inbox", "user_id", "is_read", "created_at"),
        Index("ix_notifications_deleted_at", "deleted_at"),
    )

    def __repr__(self) -> str:
        return f"<Notification id={self.id} user_id={self.user_id} type={self.type.value}>"
