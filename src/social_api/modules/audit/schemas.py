"""Audit schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogView(BaseModel):
    """Response view. before/after already PII-redacted at write time."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int | None
    action: str
    entity: str
    entity_id: int | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    ip: str | None
    user_agent: str | None
    request_id: str | None
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditLogView]
    next_cursor: str | None = None
