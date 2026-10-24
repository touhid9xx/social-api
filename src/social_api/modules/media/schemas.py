"""Media schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

MediaKindLiteral = Literal["image", "video"]


class MediaView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    post_id: int | None
    kind: MediaKindLiteral
    mime: str
    size_bytes: int
    url: str  # signed or direct URL (backend-resolved)
    created_at: datetime


class AttachMediaResponse(BaseModel):
    media: MediaView
    post_id: int
