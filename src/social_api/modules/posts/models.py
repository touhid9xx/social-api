"""Post model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin
from social_api.modules.users.models import Visibility


class Post(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[Visibility] = mapped_column(
        Enum(Visibility, name="profile_visibility"),
        nullable=False,
        default=Visibility.PUBLIC,
    )
    media_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    like_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
        Index("ix_posts_author_created", "author_id", "created_at", "id"),
        Index("ix_posts_visibility_created", "visibility", "created_at", "id"),
        Index("ix_posts_deleted_at", "deleted_at"),
        CheckConstraint("length(body) <= 5000", name="ck_posts_body_len"),
        CheckConstraint("like_count >= 0", name="ck_posts_like_count_nonneg"),
        CheckConstraint("comment_count >= 0", name="ck_posts_comment_count_nonneg"),
    )

    def __repr__(self) -> str:
        return f"<Post id={self.id} author_id={self.author_id}>"
