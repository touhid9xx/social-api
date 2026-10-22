"""User model — M4 baseline."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, func
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin
from social_api.db.types import EncryptedString


class UserRole(enum.StrEnum):
    USER = "user"
    MODERATOR = "moderator"
    ADMIN = "admin"


class User(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    # Hash of email for UNIQUE constraint (email itself is encrypted, so unique
    # index is on hash). See __init__ comment in migration.
    email_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), nullable=False, default=UserRole.USER
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        # NEVER include email in repr — PII.
        return f"<User id={self.id} role={self.role.value}>"
