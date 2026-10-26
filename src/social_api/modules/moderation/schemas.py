"""Moderation schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ReportTargetTypeLiteral = Literal["post", "comment", "user", "message"]
ReportReasonLiteral = Literal["spam", "abuse", "harassment", "other"]
ReportStatusLiteral = Literal["open", "under_review", "resolved", "dismissed"]

# Writable transition target — excludes "open". Staff can claim a report
# (→ under_review) but cannot reset it back to the initial state. Terminal
# states are further protected at the service layer (ReportLockedError).
ReportTransitionStatus = Literal["under_review", "resolved", "dismissed"]


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_type: ReportTargetTypeLiteral
    target_id: int = Field(ge=1)
    reason: ReportReasonLiteral
    details: str | None = Field(default=None, max_length=5000)


class ReportView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reporter_id: int
    target_type: ReportTargetTypeLiteral
    target_id: int
    reason: ReportReasonLiteral
    details: str | None
    status: ReportStatusLiteral
    reviewer_id: int | None
    resolution_note: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ReportPage(BaseModel):
    items: list[ReportView]
    next_cursor: str | None = None


class ReportUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ReportTransitionStatus  # excludes "open" — can't reopen
    resolution_note: str | None = Field(default=None, max_length=500)
    version: int = Field(ge=1)
