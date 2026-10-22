"""Profile + UserConsent models."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
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
from social_api.db.types import EncryptedString, EncryptedText


class Visibility(enum.StrEnum):
    """Visibility of a profile or field."""

    PUBLIC = "public"
    FOLLOWERS = "followers"
    PRIVATE = "private"


class ConsentChannel(enum.StrEnum):
    EMAIL_MARKETING = "email_marketing"
    SMS_MARKETING = "sms_marketing"
    ANALYTICS = "analytics"
    PRODUCT_UPDATES = "product_updates"


# ⚠️ Shared Enum objects — MUST reuse the SAME object across columns.
# values_callable forces DB storage to use .value (lowercase), matching
# the migration's enum('public', 'followers', 'private'). Without it,
# SQLAlchemy defaults to .name (UPPERCASE) and SELECT fails with:
#   LookupError: 'public' is not among the defined enum values
#   Enum name: visibility. Possible values: PUBLIC, FOLLOWERS, PRIVATE
visibility_enum = Enum(
    Visibility,
    name="profile_visibility",
    values_callable=lambda cls: [e.value for e in cls],
)
consent_channel_enum = Enum(
    ConsentChannel,
    name="consent_channel",
    values_callable=lambda cls: [e.value for e in cls],
)


class Profile(Base, SoftDeleteMixin, VersionMixin):
    """
    Extended user profile. One-to-one with User.

    PII columns (`dob`, `phone`, `address`) are Fernet-encrypted at rest.
    """

    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    # Non-PII, public-ish
    display_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    location: Mapped[str | None] = mapped_column(String(128), nullable=True)
    website: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # PII — encrypted at rest
    dob: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    phone: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    address: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)

    visibility: Mapped[Visibility] = mapped_column(
        visibility_enum,
        nullable=False,
        default=Visibility.PUBLIC,
    )
    pii_visibility: Mapped[Visibility] = mapped_column(
        visibility_enum,
        nullable=False,
        default=Visibility.PRIVATE,
    )

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
        Index("ix_profiles_user_id", "user_id"),
        Index("ix_profiles_visibility", "visibility"),
    )

    def __repr__(self) -> str:
        # PII NEVER in repr.
        return f"<Profile id={self.id} user_id={self.user_id}>"


class UserConsent(Base):
    """
    GDPR consent record per user per channel.

    Current state = latest row with granted=True and revoked_at IS NULL.
    Granting creates a new row; revoking updates `revoked_at`.
    Audit trail preserved (never delete).
    """

    __tablename__ = "user_consent"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[ConsentChannel] = mapped_column(
        consent_channel_enum,
        nullable=False,
    )
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(256), nullable=True)
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
        Index("ix_user_consent_user", "user_id"),
        Index("ix_user_consent_user_channel", "user_id", "channel"),
    )

    def __repr__(self) -> str:
        return (
            f"<UserConsent id={self.id} channel={self.channel.value} "
            f"granted={self.granted}>"
        )
