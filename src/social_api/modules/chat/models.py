"""Chat models: rooms, members, messages."""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from social_api.db.base import Base
from social_api.db.mixins import SoftDeleteMixin, VersionMixin


class RoomType(enum.StrEnum):
    DIRECT = "direct"
    GROUP = "group"


class MemberRole(enum.StrEnum):
    MEMBER = "member"
    ADMIN = "admin"


class ChatRoom(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "chat_rooms"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[RoomType] = mapped_column(Enum(RoomType, name="chat_room_type"), nullable=False)
    # Direct-room canonical pair: min(a,b), max(a,b). NULL for group rooms.
    canonical_user_a: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    canonical_user_b: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Group name (M16); NULL for direct rooms.
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "canonical_user_a",
            "canonical_user_b",
            name="uq_chat_rooms_direct_pair",
        ),
        CheckConstraint(
            "(type = 'DIRECT' AND canonical_user_a IS NOT NULL AND "
            " canonical_user_b IS NOT NULL AND canonical_user_a < canonical_user_b)"
            " OR "
            "(type = 'GROUP' AND canonical_user_a IS NULL AND "
            " canonical_user_b IS NULL)",
            name="ck_chat_rooms_canonical",
        ),
        Index("ix_chat_rooms_type", "type"),
        Index("ix_chat_rooms_deleted_at", "deleted_at"),
    )

    def __repr__(self) -> str:
        return f"<ChatRoom id={self.id} type={self.type.value}>"


class ChatRoomMember(Base):
    __tablename__ = "chat_room_members"

    room_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MemberRole] = mapped_column(
        Enum(MemberRole, name="chat_member_role"),
        nullable=False,
        default=MemberRole.MEMBER,
    )
    last_read_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("room_id", "user_id", name="pk_chat_room_members"),
        Index("ix_chat_members_user", "user_id"),
    )

    def __repr__(self) -> str:
        return f"<ChatRoomMember room_id={self.room_id} user_id={self.user_id}>"


class Message(Base, SoftDeleteMixin, VersionMixin):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    media_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("media.id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        Index("ix_messages_room_created", "room_id", "created_at", "id"),
        Index("ix_messages_sender", "sender_id"),
        Index("ix_messages_deleted_at", "deleted_at"),
        CheckConstraint("length(body) <= 4000", name="ck_messages_body_len"),
    )

    def __repr__(self) -> str:
        return f"<Message id={self.id} room_id={self.room_id}>"
