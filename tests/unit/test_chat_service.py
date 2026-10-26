"""Chat service: room creation, message send, read receipts."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.chat.exceptions import (
    CannotChatWithSelfError,
    ReadReceiptInvalidError,
    UserBlockedChatError,
)
from social_api.modules.chat.models import (
    ChatRoom,
    ChatRoomMember,
    MemberRole,
    Message,
    RoomType,
)
from social_api.modules.chat.service import ChatService

pytestmark = pytest.mark.unit


def _room(room_id: int = 1, type_: RoomType = RoomType.DIRECT) -> ChatRoom:
    return ChatRoom(
        id=room_id,
        type=type_,
        canonical_user_a=1,
        canonical_user_b=2,
        title=None,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        deleted_at=None,
        version=1,
    )


def _member(room_id: int, user_id: int) -> ChatRoomMember:
    return ChatRoomMember(
        room_id=room_id,
        user_id=user_id,
        role=MemberRole.MEMBER,
        last_read_message_id=None,
        joined_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _message(mid: int, room_id: int, sender_id: int) -> Message:
    return Message(
        id=mid,
        room_id=room_id,
        sender_id=sender_id,
        body="hi",
        media_id=None,
        created_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, 12, 0, tzinfo=UTC),
        deleted_at=None,
        version=1,
    )


class _FakeRepo:
    def __init__(self) -> None:
        self.rooms: dict[int, ChatRoom] = {}
        self.members: dict[tuple[int, int], ChatRoomMember] = {}
        self.messages: dict[int, Message] = {}
        self._next_room = 1
        self._next_msg = 1

    async def find_direct_room(self, *, user_a: int, user_b: int) -> ChatRoom | None:
        lo, hi = (user_a, user_b) if user_a < user_b else (user_b, user_a)
        for r in self.rooms.values():
            if r.canonical_user_a == lo and r.canonical_user_b == hi:
                return r
        return None

    async def create_direct_room(self, *, user_a: int, user_b: int) -> ChatRoom:
        lo, hi = (user_a, user_b) if user_a < user_b else (user_b, user_a)
        r = _room(self._next_room)
        r.canonical_user_a = lo
        r.canonical_user_b = hi
        self.rooms[r.id] = r
        self._next_room += 1
        return r

    async def get_room(self, room_id: int) -> ChatRoom | None:
        return self.rooms.get(room_id)

    async def add_member(
        self,
        *,
        room_id: int,
        user_id: int,
        role: MemberRole = MemberRole.MEMBER,
    ) -> ChatRoomMember:
        m = _member(room_id, user_id)
        self.members[(room_id, user_id)] = m
        return m

    async def get_member(self, *, room_id: int, user_id: int) -> ChatRoomMember | None:
        return self.members.get((room_id, user_id))

    async def list_members(self, *, room_id: int) -> list[ChatRoomMember]:
        return [m for (r, _u), m in self.members.items() if r == room_id]

    async def list_user_rooms(self, *, user_id: int, limit: int = 100) -> list[ChatRoom]:
        return [r for r in self.rooms.values() if (r.id, user_id) in self.members][:limit]

    async def create_message(
        self,
        *,
        room_id: int,
        sender_id: int,
        body: str,
        media_id: int | None,
    ) -> Message:
        m = _message(self._next_msg, room_id, sender_id)
        self.messages[m.id] = m
        self._next_msg += 1
        return m

    async def get_message(self, message_id: int) -> Message | None:
        return self.messages.get(message_id)

    async def latest_message_id_in_room(self, *, room_id: int) -> int | None:
        ids = [m.id for m in self.messages.values() if m.room_id == room_id]
        return max(ids) if ids else None

    async def update_last_read(
        self, *, room_id: int, user_id: int, message_id: int
    ) -> ChatRoomMember | None:
        m = self.members.get((room_id, user_id))
        if m is None:
            return None
        if m.last_read_message_id is None or m.last_read_message_id < message_id:
            m.last_read_message_id = message_id
        return m


class _FakeUsers:
    async def get_by_id(self, user_id: int) -> Any:
        if user_id > 0:
            return object()
        return None


class _FakeFollows:
    def __init__(self, blocked: set[tuple[int, int]] | None = None) -> None:
        self._blocked = blocked or set()

    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return (a, b) in self._blocked or (b, a) in self._blocked


def _svc(repo: _FakeRepo, follows: _FakeFollows | None = None) -> ChatService:
    svc = ChatService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._users = _FakeUsers()  # type: ignore[assignment]
    svc._follows = follows or _FakeFollows()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_create_direct_room() -> None:
    from social_api.modules.chat.schemas import DirectRoomCreate

    repo = _FakeRepo()
    svc = _svc(repo)
    room = await svc.find_or_create_direct(user_id=1, payload=DirectRoomCreate(other_user_id=2))
    assert room.id == 1
    assert (1, 1) in repo.members
    assert (1, 2) in repo.members


@pytest.mark.asyncio
async def test_create_direct_room_idempotent() -> None:
    from social_api.modules.chat.schemas import DirectRoomCreate

    repo = _FakeRepo()
    svc = _svc(repo)
    r1 = await svc.find_or_create_direct(user_id=1, payload=DirectRoomCreate(other_user_id=2))
    r2 = await svc.find_or_create_direct(user_id=2, payload=DirectRoomCreate(other_user_id=1))
    assert r1.id == r2.id


@pytest.mark.asyncio
async def test_self_chat_forbidden() -> None:
    from social_api.modules.chat.schemas import DirectRoomCreate

    with pytest.raises(CannotChatWithSelfError):
        await _svc(_FakeRepo()).find_or_create_direct(
            user_id=1, payload=DirectRoomCreate(other_user_id=1)
        )


@pytest.mark.asyncio
async def test_blocked_chat_forbidden() -> None:
    from social_api.modules.chat.schemas import DirectRoomCreate

    repo = _FakeRepo()
    with pytest.raises(UserBlockedChatError):
        await _svc(repo, _FakeFollows(blocked={(1, 2)})).find_or_create_direct(
            user_id=1, payload=DirectRoomCreate(other_user_id=2)
        )


@pytest.mark.asyncio
async def test_send_message_not_member() -> None:
    from social_api.modules.chat.exceptions import ChatRoomForbiddenError
    from social_api.modules.chat.schemas import MessageCreate

    repo = _FakeRepo()
    # Room exists without user 99 membership
    r = _room(room_id=1)
    repo.rooms[1] = r

    with pytest.raises(ChatRoomForbiddenError):
        await _svc(repo).send_message(
            sender_id=99,
            room_id=1,
            payload=MessageCreate(body="hi"),
        )


@pytest.mark.asyncio
async def test_mark_read_advances() -> None:
    from social_api.modules.chat.schemas import MessageCreate

    repo = _FakeRepo()
    svc = _svc(repo)
    # Create room + members + message
    repo.rooms[1] = _room(room_id=1)
    await repo.add_member(room_id=1, user_id=1)
    await repo.add_member(room_id=1, user_id=2)
    m = await svc.send_message(sender_id=2, room_id=1, payload=MessageCreate(body="hi"))

    out = await svc.mark_read(user_id=1, room_id=1, message_id=m.id)
    assert out.last_read_message_id == m.id


@pytest.mark.asyncio
async def test_mark_read_invalid_message() -> None:
    repo = _FakeRepo()
    repo.rooms[1] = _room(room_id=1)
    await repo.add_member(room_id=1, user_id=1)

    with pytest.raises(ReadReceiptInvalidError):
        await _svc(repo).mark_read(user_id=1, room_id=1, message_id=999)


@pytest.mark.asyncio
async def test_delete_foreign_message_forbidden() -> None:
    from social_api.modules.auth.models import User, UserRole
    from social_api.modules.chat.exceptions import MessageForbiddenError

    repo = _FakeRepo()
    m = _message(1, room_id=1, sender_id=2)
    repo.messages[1] = m

    actor = User(
        id=99,
        email="x@example.com",
        email_hash="h",
        password_hash="x",
        role=UserRole.USER,
        is_active=True,
        is_verified=False,
    )
    actor.created_at = datetime(2026, 1, 1, tzinfo=UTC)

    with pytest.raises(MessageForbiddenError):
        await _svc(repo).delete_message(actor=actor, message_id=1)
