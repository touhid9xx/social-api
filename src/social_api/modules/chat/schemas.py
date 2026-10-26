"""Chat schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RoomTypeLiteral = Literal["direct", "group"]


class DirectRoomCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    other_user_id: int = Field(ge=1)


class RoomView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: RoomTypeLiteral
    title: str | None
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)
    media_id: int | None = Field(default=None, ge=1)


class MessageView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    room_id: int
    sender_id: int
    body: str
    media_id: int | None
    created_at: datetime
    is_edited: bool = False


class MessagePage(BaseModel):
    items: list[MessageView]
    next_cursor: str | None = None


class MemberReadState(BaseModel):
    user_id: int
    last_read_message_id: int | None


class ReadReceiptsList(BaseModel):
    members: list[MemberReadState]


class ReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: int = Field(ge=1)


class UnreadCount(BaseModel):
    unread: int
