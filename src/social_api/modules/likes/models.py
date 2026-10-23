"""Like model — polymorphic (posts + comments)."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base


class LikeTarget(enum.StrEnum):
    POST = "post"
    COMMENT = "comment"


class Like(Base):
    """
    One row per (user, target_type, target_id).

    No FK to target because target_type varies (polymorphic).
    Target tables cascade: like rows survive target soft-delete but are
    hard-deleted when the target row is hard-deleted (M19).
    """

    __tablename__ = "likes"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[LikeTarget] = mapped_column(
        Enum(LikeTarget, name="like_target"), nullable=False
    )
    target_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("user_id", "target_type", "target_id", name="pk_likes"),
        Index("ix_likes_target", "target_type", "target_id"),
    )

    def __repr__(self) -> str:
        return f"<Like user={self.user_id} {self.target_type.value}:{self.target_id}>"
