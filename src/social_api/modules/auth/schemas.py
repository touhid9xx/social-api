"""Auth Pydantic schemas — Pydantic v2 strict."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from social_api.core.password import WeakPasswordError, validate_password_policy


# ---- Requests ----
class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def _validate_password(cls, v: str) -> str:
        try:
            validate_password_policy(v)
        except WeakPasswordError as exc:
            raise ValueError(str(exc)) from exc
        return v


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=10)


# ---- Responses ----
class UserPublic(BaseModel):
    """Response-safe user view. NO PII beyond id/role/is_active/is_verified/created_at."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "moderator", "admin"]
    is_active: bool
    is_verified: bool
    created_at: datetime


class AuthTokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int  # access token TTL seconds


class RegisterResponse(BaseModel):
    user: UserPublic
    message: str


class LoginResponse(BaseModel):
    user: UserPublic
    tokens: AuthTokens
