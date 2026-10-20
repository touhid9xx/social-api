"""Reusable ORM mixins."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column


class SoftDeleteMixin:
    """Soft delete via deleted_at. Never hard delete except via Celery job."""

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False), nullable=True, default=None, index=True
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class VersionMixin:
    """Optimistic locking."""

    version: Mapped[int] = mapped_column(default=1, nullable=False)
