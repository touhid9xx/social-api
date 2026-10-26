"""Chat repository."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.chat.models import (
    ChatRoom,
    ChatRoomMember,
    MemberRole,
    Message,
    RoomType,
)


def _rowcount(res: Any) -> int:
    """Extract rowcount from a DML Result.

    SQLAlchemy 2.0's Result protocol doesn't expose .rowcount in the type
    system — only CursorResult does, and mypy can't narrow Result →
    CursorResult automatically. getattr with a default is the cleanest
    bridge; see social_api.db.helpers.execute_dml for the same pattern.
    """
    return int(getattr(res, "rowcount", 0) or 0)


class ChatRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    # ---- Rooms ----
    async def find_direct_room(self, *, user_a: int, user_b: int) -> ChatRoom | None:
        lo, hi = (user_a, user_b) if user_a < user_b else (user_b, user_a)
        stmt = select(ChatRoom).where(
            ChatRoom.type == RoomType.DIRECT,
            ChatRoom.canonical_user_a == lo,
            ChatRoom.canonical_user_b == hi,
            ChatRoom.deleted_at.is_(None),
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create_direct_room(self, *, user_a: int, user_b: int) -> ChatRoom:
        lo, hi = (user_a, user_b) if user_a < user_b else (user_b, user_a)
        room = ChatRoom(
            type=RoomType.DIRECT,
            canonical_user_a=lo,
            canonical_user_b=hi,
        )
        self._s.add(room)
        try:
            await self._s.flush()
        except IntegrityError:
            # Race: another request created it. Fetch.
            await self._s.rollback()
            existing = await self.find_direct_room(user_a=user_a, user_b=user_b)
            if existing is None:
                raise
            return existing
        await self._s.refresh(room)
        return room

    async def get_room(self, room_id: int) -> ChatRoom | None:
        stmt = select(ChatRoom).where(ChatRoom.id == room_id, ChatRoom.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def add_member(
        self,
        *,
        room_id: int,
        user_id: int,
        role: MemberRole = MemberRole.MEMBER,
    ) -> ChatRoomMember:
        member = ChatRoomMember(room_id=room_id, user_id=user_id, role=role)
        self._s.add(member)
        try:
            await self._s.flush()
        except IntegrityError:
            await self._s.rollback()
            existing = await self.get_member(room_id=room_id, user_id=user_id)
            if existing is None:
                raise
            return existing
        await self._s.refresh(member)
        return member

    async def get_member(self, *, room_id: int, user_id: int) -> ChatRoomMember | None:
        stmt = select(ChatRoomMember).where(
            ChatRoomMember.room_id == room_id,
            ChatRoomMember.user_id == user_id,
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def list_members(self, *, room_id: int) -> list[ChatRoomMember]:
        stmt = (
            select(ChatRoomMember)
            .where(ChatRoomMember.room_id == room_id)
            .order_by(ChatRoomMember.joined_at.asc())
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_user_rooms(self, *, user_id: int, limit: int = 100) -> list[ChatRoom]:
        # Rooms the user is a member of, newest activity first.
        stmt = (
            select(ChatRoom)
            .join(
                ChatRoomMember,
                ChatRoomMember.room_id == ChatRoom.id,
            )
            .where(
                ChatRoomMember.user_id == user_id,
                ChatRoom.deleted_at.is_(None),
            )
            .order_by(ChatRoom.updated_at.desc(), ChatRoom.id.desc())
            .limit(limit)
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    # ---- Messages ----
    async def create_message(
        self,
        *,
        room_id: int,
        sender_id: int,
        body: str,
        media_id: int | None,
    ) -> Message:
        m = Message(
            room_id=room_id,
            sender_id=sender_id,
            body=body,
            media_id=media_id,
        )
        self._s.add(m)
        await self._s.flush()
        await self._s.refresh(m)

        # Bump room.updated_at so "my rooms" sort reflects latest activity.
        await self._s.execute(
            update(ChatRoom).where(ChatRoom.id == room_id).values(updated_at=func.now())
        )
        return m

    async def get_message(self, message_id: int) -> Message | None:
        stmt = select(Message).where(Message.id == message_id, Message.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def list_messages(
        self,
        *,
        room_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Message]:
        stmt = select(Message).where(Message.room_id == room_id, Message.deleted_at.is_(None))
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Message.created_at < cursor_ts,
                    and_(
                        Message.created_at == cursor_ts,
                        Message.id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Message.created_at.desc(), Message.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def save_message(self, msg: Message) -> None:
        await self._s.flush()

    async def latest_message_id_in_room(self, *, room_id: int) -> int | None:
        stmt = select(func.max(Message.id)).where(
            Message.room_id == room_id, Message.deleted_at.is_(None)
        )
        res = await self._s.execute(stmt)
        val = res.scalar_one_or_none()
        return int(val) if val is not None else None

    async def unread_count(
        self,
        *,
        room_id: int,
        user_id: int,
        since_message_id: int | None,
    ) -> int:
        stmt = (
            select(func.count())
            .select_from(Message)
            .where(
                Message.room_id == room_id,
                Message.sender_id != user_id,
                Message.deleted_at.is_(None),
            )
        )
        if since_message_id is not None:
            stmt = stmt.where(Message.id > since_message_id)
        res = await self._s.execute(stmt)
        return int(res.scalar_one())

    # ---- Read receipts ----
    async def update_last_read(
        self, *, room_id: int, user_id: int, message_id: int
    ) -> ChatRoomMember | None:
        member = await self.get_member(room_id=room_id, user_id=user_id)
        if member is None:
            return None
        # Monotonic: only advance.
        if member.last_read_message_id is None or member.last_read_message_id < message_id:
            member.last_read_message_id = message_id
            await self._s.flush()
        return member

    # ---- Group rooms ----
    async def create_group_room(
        self, *, title: str, admin_id: int, member_ids: list[int]
    ) -> ChatRoom:
        room = ChatRoom(type=RoomType.GROUP, title=title)
        self._s.add(room)
        await self._s.flush()
        await self._s.refresh(room)

        # Admin first, then members. Add order matters for joined_at sort.
        await self.add_member(room_id=room.id, user_id=admin_id, role=MemberRole.ADMIN)
        for uid in member_ids:
            await self.add_member(
                room_id=room.id,
                user_id=uid,
                role=MemberRole.MEMBER,
            )
        return room

    async def remove_member(self, *, room_id: int, user_id: int) -> bool:
        stmt = delete(ChatRoomMember).where(
            ChatRoomMember.room_id == room_id,
            ChatRoomMember.user_id == user_id,
        )
        res = await self._s.execute(stmt)
        return _rowcount(res) > 0

    async def count_admins(self, *, room_id: int) -> int:
        stmt = (
            select(func.count())
            .select_from(ChatRoomMember)
            .where(
                ChatRoomMember.room_id == room_id,
                ChatRoomMember.role == MemberRole.ADMIN,
            )
        )
        res = await self._s.execute(stmt)
        return int(res.scalar_one())

    async def count_members(self, *, room_id: int) -> int:
        stmt = (
            select(func.count())
            .select_from(ChatRoomMember)
            .where(ChatRoomMember.room_id == room_id)
        )
        res = await self._s.execute(stmt)
        return int(res.scalar_one())

    async def save_room(self, room: ChatRoom) -> None:
        await self._s.flush()
        await self._s.refresh(room)  # pull server-generated updated_at

    async def soft_delete_room(self, *, room_id: int) -> None:
        room = await self.get_room(room_id)
        if room is None:
            return
        room.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._s.flush()
