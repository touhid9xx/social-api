"""Media model."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin


class MediaKind(enum.StrEnum):
    IMAGE = "image"
    VIDEO = "video"


# Shared Enum type — reuse across columns of the same type.
# values_callable forces SQLAlchemy to store/read .value (lowercase),
# matching the DB column enum('image','video') created by 0006_media.
media_kind_enum = Enum(
    MediaKind,
    name="media_kind",
    values_callable=lambda cls: [e.value for e in cls],
)


class Media(Base, SoftDeleteMixin, VersionMixin):
    """
    One row per uploaded, deduplicated object.

    Dedup key: (owner_id, sha256) is unique — same user re-uploading the
    same bytes is a no-op returning the existing row.

    post_id: set when attached to a post. NULL while unattached (orphan).
    """

    __tablename__ = "media"

    id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )
    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    post_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("posts.id", ondelete="SET NULL"), nullable=True
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[MediaKind] = mapped_column(
        media_kind_enum,
        nullable=False,
    )
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

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
        Index("ix_media_owner_created", "owner_id", "created_at"),
        Index("ix_media_post_id", "post_id"),
        UniqueConstraint("owner_id", "sha256", name="uq_media_owner_sha"),
        Index("ix_media_deleted_at", "deleted_at"),
        CheckConstraint("size_bytes > 0", name="ck_media_size_positive"),
    )

    def __repr__(self) -> str:
        return f"<Media id={self.id} kind={self.kind.value} size={self.size_bytes}>"
