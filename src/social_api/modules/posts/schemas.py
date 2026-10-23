"""Posts schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

VisibilityLiteral = Literal["public", "followers", "private"]


class PostCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=5000)
    visibility: VisibilityLiteral = "public"


class PostUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str | None = Field(default=None, min_length=1, max_length=5000)
    visibility: VisibilityLiteral | None = None
    version: int = Field(ge=1)


class PostView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int
    body: str
    visibility: VisibilityLiteral
    like_count: int
    comment_count: int
    media_count: int
    created_at: datetime
    updated_at: datetime
    # Viewer-relative — filled in by service
    is_liked_by_me: bool = False
    is_edited: bool = False


class PostPage(BaseModel):
    items: list[PostView]
    next_cursor: str | None = None
