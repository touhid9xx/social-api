"""Presence schemas."""

from __future__ import annotations

from pydantic import BaseModel


class PresenceView(BaseModel):
    user_id: int
    online: bool
    connections: int
