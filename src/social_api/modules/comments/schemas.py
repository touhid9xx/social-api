"""Comments schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = Field(default=None, ge=1)


class CommentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=2000)
    version: int = Field(ge=1)


class CommentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    post_id: int
    author_id: int
    parent_id: int | None
    depth: int
    body: str
    like_count: int
    created_at: datetime
    updated_at: datetime
    is_liked_by_me: bool = False
    is_edited: bool = False
    replies: list[CommentView] = Field(default_factory=list)


class CommentPage(BaseModel):
    items: list[CommentView]
    next_cursor: str | None = None


# Enable forward ref
CommentView.model_rebuild()
