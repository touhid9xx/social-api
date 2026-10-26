"""Group chat: create, admin leave rules, media validation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.chat.exceptions import (
    AdminRequiredError,
    AlreadyMemberError,
    DirectChatNotAllowedError,
    LastAdminCannotLeaveError,
    MediaAlreadyUsedError,
    MediaNotOwnedError,
)
from social_api.modules.chat.models import (
    ChatRoom,
    ChatRoomMember,
    MemberRole,
    Message,
    RoomType,
)
from social_api.modules.chat.schemas import (
    GroupRoomCreate,
    MessageCreate,
)
from social_api.modules.chat.service import ChatService
from social_api.modules.media.models import Media, MediaKind

pytestmark = pytest.mark.unit


def _room(
    rid: int = 1,
    type_: RoomType = RoomType.GROUP,
    admin_id: int = 1,
) -> ChatRoom:
    return ChatRoom(
        id=rid,
        type=type_,
        canonical_user_a=None,
        canonical_user_b=None,
        title="team" if type_ == RoomType.GROUP else None,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        deleted_at=None,
        version=1,
    )


def _member(rid: int, uid: int, role: MemberRole = MemberRole.MEMBER) -> ChatRoomMember:
    return ChatRoomMember(
        room_id=rid,
        user_id=uid,
        role=role,
        last_read_message_id=None,
        joined_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def _media(mid: int, owner_id: int) -> Media:
    return Media(
        id=mid,
        owner_id=owner_id,
        post_id=None,
        message_id=None,
        sha256="a" * 64,
        mime="image/png",
        kind=MediaKind.IMAGE,
        size_bytes=1024,
        storage_key=f"{owner_id}/a.png",
        original_name="a.png",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        deleted_at=None,
        version=1,
    )


class _FakeChatRepo:
    def __init__(self) -> None:
        self.rooms: dict[int, ChatRoom] = {}
        self.members: dict[tuple[int, int], ChatRoomMember] = {}
        self._next_room = 1

    async def get_room(self, room_id: int) -> ChatRoom | None:
        return self.rooms.get(room_id)

    async def get_member(self, *, room_id: int, user_id: int) -> ChatRoomMember | None:
        return self.members.get((room_id, user_id))

    async def list_members(self, *, room_id: int) -> list[ChatRoomMember]:
        return [m for (r, _u), m in self.members.items() if r == room_id]

    async def add_member(
        self,
        *,
        room_id: int,
        user_id: int,
        role: MemberRole = MemberRole.MEMBER,
    ) -> ChatRoomMember:
        m = _member(room_id, user_id, role)
        self.members[(room_id, user_id)] = m
        return m

    async def create_group_room(
        self, *, title: str, admin_id: int, member_ids: list[int]
    ) -> ChatRoom:
        r = _room(self._next_room)
        r.title = title
        self.rooms[r.id] = r
        self._next_room += 1
        await self.add_member(room_id=r.id, user_id=admin_id, role=MemberRole.ADMIN)
        for uid in member_ids:
            await self.add_member(room_id=r.id, user_id=uid, role=MemberRole.MEMBER)
        return r

    async def remove_member(self, *, room_id: int, user_id: int) -> bool:
        return self.members.pop((room_id, user_id), None) is not None

    async def count_admins(self, *, room_id: int) -> int:
        return sum(
            1 for (r, _u), m in self.members.items() if r == room_id and m.role == MemberRole.ADMIN
        )

    async def count_members(self, *, room_id: int) -> int:
        return sum(1 for (r, _u) in self.members if r == room_id)

    async def save_room(self, room: ChatRoom) -> None:
        self.rooms[room.id] = room

    async def soft_delete_room(self, *, room_id: int) -> None:
        r = self.rooms.get(room_id)
        if r is not None:
            r.deleted_at = datetime.now(UTC).replace(tzinfo=None)

    async def create_message(
        self,
        *,
        room_id: int,
        sender_id: int,
        body: str,
        media_id: int | None,
    ) -> Message:
        return Message(
            id=1,
            room_id=room_id,
            sender_id=sender_id,
            body=body,
            media_id=media_id,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            deleted_at=None,
            version=1,
        )


class _FakeUsers:
    async def get_by_id(self, user_id: int) -> Any:
        return object() if user_id > 0 else None


class _FakeFollows:
    def __init__(self, blocked: set[tuple[int, int]] | None = None) -> None:
        self._blocked = blocked or set()

    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return (a, b) in self._blocked or (b, a) in self._blocked


class _FakeMediaRepo:
    def __init__(self, media: dict[int, Media] | None = None) -> None:
        self._media = media or {}

    async def get_by_id(self, media_id: int) -> Media | None:
        return self._media.get(media_id)

    async def save(self, m: Media) -> None:
        self._media[m.id] = m


def _svc(
    repo: _FakeChatRepo,
    *,
    follows: _FakeFollows | None = None,
    media_repo: _FakeMediaRepo | None = None,
) -> ChatService:
    svc = ChatService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._users = _FakeUsers()  # type: ignore[assignment]
    svc._follows = follows or _FakeFollows()  # type: ignore[assignment]
    # Fakes intentionally don't inherit MediaRepository — the service only
    # uses get_by_id + save, which _FakeMediaRepo provides structurally.
    svc._media_repo = media_repo or _FakeMediaRepo()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_create_group_adds_admin_and_members() -> None:
    repo = _FakeChatRepo()
    svc = _svc(repo)
    room = await svc.create_group(
        creator_id=1,
        payload=GroupRoomCreate(title="t", member_ids=[2, 3]),
    )
    assert room.type == "group"
    assert (1, 1) in repo.members
    assert repo.members[(1, 1)].role == MemberRole.ADMIN
    assert (1, 2) in repo.members
    assert (1, 3) in repo.members


@pytest.mark.asyncio
async def test_add_member_requires_admin() -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.ADMIN)
    await repo.add_member(room_id=1, user_id=2, role=MemberRole.MEMBER)
    svc = _svc(repo)

    with pytest.raises(AdminRequiredError):
        await svc.add_member(actor_id=2, room_id=1, target_id=99)


@pytest.mark.asyncio
async def test_add_member_existing_conflict() -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.ADMIN)
    await repo.add_member(room_id=1, user_id=2, role=MemberRole.MEMBER)
    svc = _svc(repo)

    with pytest.raises(AlreadyMemberError):
        await svc.add_member(actor_id=1, room_id=1, target_id=2)


@pytest.mark.asyncio
async def test_last_admin_cannot_leave_nonempty() -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.ADMIN)
    await repo.add_member(room_id=1, user_id=2, role=MemberRole.MEMBER)
    svc = _svc(repo)

    with pytest.raises(LastAdminCannotLeaveError):
        await svc.remove_member(actor_id=1, room_id=1, target_id=1)


@pytest.mark.asyncio
async def test_last_admin_leaves_empty_room() -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.ADMIN)
    svc = _svc(repo)
    # No exception
    await svc.remove_member(actor_id=1, room_id=1, target_id=1)
    # Room soft-deleted
    assert repo.rooms[1].deleted_at is not None


@pytest.mark.asyncio
async def test_direct_room_rejects_group_ops() -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1, type_=RoomType.DIRECT)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.ADMIN)
    svc = _svc(repo)

    with pytest.raises(DirectChatNotAllowedError):
        await svc.add_member(actor_id=1, room_id=1, target_id=2)


@pytest.mark.asyncio
async def test_send_message_with_media_owned(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1, type_=RoomType.DIRECT)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.MEMBER)

    m = _media(100, owner_id=1)
    media_repo = _FakeMediaRepo({100: m})
    svc = _svc(repo, media_repo=media_repo)

    # Prevent WS publish attempt
    async def _noop(*a: Any, **kw: Any) -> None:
        return None

    monkeypatch.setattr(svc, "_publish_message_event", _noop)

    out = await svc.send_message(
        sender_id=1,
        room_id=1,
        payload=MessageCreate(body="pic", media_id=100),
    )
    assert out.media_id == 100
    assert m.message_id == 1  # attached


@pytest.mark.asyncio
async def test_send_message_media_foreign_forbidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1, type_=RoomType.DIRECT)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.MEMBER)

    m = _media(100, owner_id=2)  # owned by other
    media_repo = _FakeMediaRepo({100: m})
    svc = _svc(repo, media_repo=media_repo)

    async def _noop(*a: Any, **kw: Any) -> None:
        return None

    monkeypatch.setattr(svc, "_publish_message_event", _noop)

    with pytest.raises(MediaNotOwnedError):
        await svc.send_message(
            sender_id=1,
            room_id=1,
            payload=MessageCreate(body="x", media_id=100),
        )


@pytest.mark.asyncio
async def test_send_message_media_already_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _FakeChatRepo()
    repo.rooms[1] = _room(1, type_=RoomType.DIRECT)
    await repo.add_member(room_id=1, user_id=1, role=MemberRole.MEMBER)

    m = _media(100, owner_id=1)
    m.message_id = 999  # already attached
    media_repo = _FakeMediaRepo({100: m})
    svc = _svc(repo, media_repo=media_repo)

    async def _noop(*a: Any, **kw: Any) -> None:
        return None

    monkeypatch.setattr(svc, "_publish_message_event", _noop)

    with pytest.raises(MediaAlreadyUsedError):
        await svc.send_message(
            sender_id=1,
            room_id=1,
            payload=MessageCreate(body="x", media_id=100),
        )
