"""Follows schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FollowUserView(BaseModel):
    """One entry in a followers/following list. PII-free."""

    model_config = ConfigDict(from_attributes=True)

    user_id: int
    display_name: str | None = None
    avatar_url: str | None = None
    followed_at: datetime


class FollowListPage(BaseModel):
    items: list[FollowUserView]
    next_cursor: str | None = None


class FollowStatus(BaseModel):
    is_following: bool
    is_followed_by: bool
    is_blocked_by_me: bool
    has_blocked_me: bool
    is_muted_by_me: bool


class FollowCounts(BaseModel):
    followers: int
    following: int
