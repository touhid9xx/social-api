"""Comment model (nested, depth max 2)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin

# Depth 1 = top-level, depth 2 = reply to top-level. Depth 3 forbidden.
MAX_COMMENT_DEPTH = 2


class Comment(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True
    )
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    like_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
        Index("ix_comments_post_created", "post_id", "created_at", "id"),
        Index("ix_comments_parent_created", "parent_id", "created_at", "id"),
        Index("ix_comments_author", "author_id"),
        Index("ix_comments_deleted_at", "deleted_at"),
        CheckConstraint("length(body) <= 2000", name="ck_comments_body_len"),
        CheckConstraint("depth >= 1 AND depth <= 2", name="ck_comments_depth_range"),
        CheckConstraint("like_count >= 0", name="ck_comments_like_count_nonneg"),
    )

    def __repr__(self) -> str:
        return f"<Comment id={self.id} post_id={self.post_id} depth={self.depth}>"
