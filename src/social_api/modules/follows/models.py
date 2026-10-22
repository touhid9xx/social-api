"""Follow / Block / Mute models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base


class Follow(Base):
    """
    Directed follow edge: follower_id -> followee_id.

    Composite PK gives natural idempotency via ON CONFLICT in repository.
    """

    __tablename__ = "follows"

    follower_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    followee_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("follower_id", "followee_id", name="pk_follows"),
        CheckConstraint("follower_id <> followee_id", name="ck_follows_not_self"),
        Index("ix_follows_followee_created", "followee_id", "created_at"),
        Index("ix_follows_follower_created", "follower_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Follow {self.follower_id}->{self.followee_id}>"


class Block(Base):
    """blocker_id blocked blocked_id. Also used to silently unfollow."""

    __tablename__ = "blocks"

    blocker_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    blocked_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("blocker_id", "blocked_id", name="pk_blocks"),
        CheckConstraint("blocker_id <> blocked_id", name="ck_blocks_not_self"),
        Index("ix_blocks_blocked_id", "blocked_id"),
    )

    def __repr__(self) -> str:
        return f"<Block {self.blocker_id}->x->{self.blocked_id}>"


class Mute(Base):
    """muter_id muted muted_id. Mute is silent (target not notified)."""

    __tablename__ = "mutes"

    muter_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    muted_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("muter_id", "muted_id", name="pk_mutes"),
        CheckConstraint("muter_id <> muted_id", name="ck_mutes_not_self"),
        Index("ix_mutes_muted_id", "muted_id"),
    )

    def __repr__(self) -> str:
        return f"<Mute {self.muter_id}->{self.muted_id}>"
