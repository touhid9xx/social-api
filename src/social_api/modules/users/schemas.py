"""Users + profile + consent schemas. All PII-free on the wire."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

VisibilityLiteral = Literal["public", "followers", "private"]
# Mirrors UserPublic.role and auth.models.UserRole exactly — declared as a
# Literal (not the enum) so FastAPI emits the same inline string schema
# the rest of the auth surface already uses.
UserRoleLiteral = Literal["user", "moderator", "admin"]
ConsentChannelLiteral = Literal["email_marketing", "sms_marketing", "analytics", "product_updates"]


# ---- Public profile ----
class ProfilePublic(BaseModel):
    """What any authenticated user sees for a public profile. NO PII."""

    model_config = ConfigDict(from_attributes=True)

    user_id: int
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    location: str | None = None
    website: str | None = None
    visibility: VisibilityLiteral


class ProfileSelf(BaseModel):
    """What the owner sees for their own profile. Contains own PII."""

    model_config = ConfigDict(from_attributes=True)

    user_id: int
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    location: str | None = None
    website: str | None = None
    visibility: VisibilityLiteral
    pii_visibility: VisibilityLiteral
    # PII (only returned to the owner)
    dob: str | None = None
    phone: str | None = None
    address: str | None = None
    version: int
    created_at: datetime
    updated_at: datetime


# ---- Update ----
class ProfileUpdate(BaseModel):
    """PATCH body. Every field optional. Only present keys updated."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    bio: str | None = Field(default=None, max_length=500)
    avatar_url: HttpUrl | None = None
    location: str | None = Field(default=None, max_length=128)
    website: HttpUrl | None = None
    visibility: VisibilityLiteral | None = None
    pii_visibility: VisibilityLiteral | None = None
    dob: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=512)
    # Required for optimistic locking
    version: int = Field(ge=1)

    @field_validator("dob")
    @classmethod
    def _dob_iso(cls, v: str | None) -> str | None:
        if v is None:
            return None
        from datetime import date

        try:
            date.fromisoformat(v)
        except ValueError as exc:
            raise ValueError("dob must be ISO date YYYY-MM-DD") from exc
        return v


# ---- Consent ----
class ConsentGrantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: ConsentChannelLiteral


class ConsentRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    channel: ConsentChannelLiteral
    granted: bool
    granted_at: datetime | None
    revoked_at: datetime | None


class ConsentList(BaseModel):
    consents: list[ConsentRecord]


# ---- Delete ----
class DeleteMeResponse(BaseModel):
    message: str
    hard_delete_after: datetime


# ---- Admin directory ----
class AdminUserView(BaseModel):
    """One row of the staff-only user directory.

    Field-for-field the same PII posture as `UserPublic` (no email, no
    phone — the encrypted columns stay encrypted and unexposed), plus the
    display name/avatar so the console doesn't need a per-row
    `/users/{id}` fetch.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    role: UserRoleLiteral
    is_active: bool
    is_verified: bool
    created_at: datetime
    display_name: str | None = None
    avatar_url: str | None = None


class AdminUserPage(BaseModel):
    items: list[AdminUserView]
    next_cursor: str | None = None
