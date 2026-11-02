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

# Which slice of the inbox a read is about.
#   all    — everything (the default; unchanged behaviour for existing callers);
#   social — a person's personal activity: follows, likes, comments;
#   system — staff traffic only (`admin_new_user` today).
# Both read endpoints and the bulk read-all accept it, so a screen that shows a
# slice can also clear that slice without touching the personal inbox.
NotificationScopeLiteral = Literal["all", "social", "system"]


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
