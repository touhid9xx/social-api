"""Notification schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

NotificationTypeLiteral = Literal[
    "follow",
    "like_post",
    "like_comment",
    "comment_post",
    "comment_reply",
    "admin_new_user",
]

NotificationTargetTypeLiteral = Literal["user", "post", "comment"]


class NotificationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: NotificationTypeLiteral
    target_type: NotificationTargetTypeLiteral
    target_id: int
    actor_id: int
    is_read: bool
    read_at: datetime | None
    preview: str | None
    created_at: datetime


class NotificationPage(BaseModel):
    items: list[NotificationView]
    next_cursor: str | None = None


class UnreadCount(BaseModel):
    unread: int


class MarkReadResponse(BaseModel):
    updated: int
