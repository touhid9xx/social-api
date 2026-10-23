"""Likes schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

LikeTargetLiteral = Literal["post", "comment"]


class LikeUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    display_name: str | None = None
    avatar_url: str | None = None


class LikeUserPage(BaseModel):
    items: list[LikeUser]
    next_cursor: str | None = None
