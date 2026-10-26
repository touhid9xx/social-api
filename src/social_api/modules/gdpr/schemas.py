"""GDPR schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ExportPayload(BaseModel):
    """Full user data export. Only returned to the requesting user."""

    exported_at: datetime
    version: str = "1.0"
    user: dict[str, Any]
    profile: dict[str, Any] | None
    consents: list[dict[str, Any]]
    posts: list[dict[str, Any]]
    comments: list[dict[str, Any]]
    likes: list[dict[str, Any]]
    follows: dict[str, list[int]]
    blocks: list[int]
    mutes: list[int]
    chat_rooms: list[dict[str, Any]]
    notifications: list[dict[str, Any]]
    reports_made: list[dict[str, Any]]


class DeletionStatusView(BaseModel):
    scheduled: bool
    scheduled_hard_delete_at: datetime | None
    status: str  # scheduled | completed | cancelled | none


class CancelResponse(BaseModel):
    message: str
