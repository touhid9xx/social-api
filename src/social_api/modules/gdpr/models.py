"""DeletionRequest model."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin


class DeletionStatus(enum.StrEnum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class DeletionRequest(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "deletion_requests"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    scheduled_hard_delete_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False
    )
    status: Mapped[DeletionStatus] = mapped_column(
        Enum(DeletionStatus, name="deletion_status"),
        nullable=False,
        default=DeletionStatus.SCHEDULED,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)

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
        Index("ix_deletion_user", "user_id"),
        Index(
            "ix_deletion_status_scheduled",
            "status",
            "scheduled_hard_delete_at",
        ),
        Index("ix_deletion_deleted_at", "deleted_at"),
    )

    def __repr__(self) -> str:
        return f"<DeletionRequest id={self.id} user_id={self.user_id} status={self.status.value}>"
