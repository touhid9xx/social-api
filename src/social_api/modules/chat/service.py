"""Chat service."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.repository import UserRepository
from social_api.modules.chat.exceptions import (
    CannotChatWithSelfError,
    ChatRoomForbiddenError,
    ChatRoomNotFoundError,
    MessageForbiddenError,
    MessageNotFoundError,
    ReadReceiptInvalidError,
    UserBlockedChatError,
)
from social_api.modules.chat.models import ChatRoom, Message
from social_api.modules.chat.repository import ChatRepository
from social_api.modules.chat.schemas import (
    DirectRoomCreate,
    MemberReadState,
    MessageCreate,
    MessagePage,
    MessageView,
    ReadReceiptsList,
    RoomView,
    UnreadCount,
)
from social_api.modules.follows.repository import FollowsRepository

logger = get_logger(__name__)


def _to_room_view(room: ChatRoom) -> RoomView:
    return RoomView(
        id=room.id,
        type=room.type.value,
        title=room.title,
        created_at=room.created_at,
        updated_at=room.updated_at,
    )


def _to_message_view(m: Message) -> MessageView:
    return MessageView(
        id=m.id,
        room_id=m.room_id,
        sender_id=m.sender_id,
        body=m.body,
        media_id=m.media_id,
        created_at=m.created_at,
        is_edited=m.updated_at > m.created_at,
    )


class ChatService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = ChatRepository(session)
        self._users = UserRepository(session)
        self._follows = FollowsRepository(session)

    # ---- Rooms ----
    async def find_or_create_direct(self, *, user_id: int, payload: DirectRoomCreate) -> RoomView:
        if payload.other_user_id == user_id:
            raise CannotChatWithSelfError()

        target = await self._users.get_by_id(payload.other_user_id)
        if target is None:
            raise ChatRoomNotFoundError()

        if await self._follows.blocked_either_direction(user_id, payload.other_user_id):
            raise UserBlockedChatError()

        # Fast path: existing room between these two users.
        existing = await self._repo.find_direct_room(user_a=user_id, user_b=payload.other_user_id)
        if existing is not None:
            return _to_room_view(existing)

        # New room. The repo enforces the canonical user_a < user_b pair
        # under a UNIQUE constraint, so concurrent create attempts
        # (A→B vs B→A) safely collapse to a single row via INSERT IGNORE.
        room = await self._repo.create_direct_room(user_a=user_id, user_b=payload.other_user_id)
        await self._repo.add_member(room_id=room.id, user_id=user_id)
        await self._repo.add_member(room_id=room.id, user_id=payload.other_user_id)
        logger.info(
            "chat_direct_room_created",
            room_id=room.id,
            user_a=user_id,
            user_b=payload.other_user_id,
        )
        return _to_room_view(room)

    async def get_room_for_member(self, *, user_id: int, room_id: int) -> ChatRoom:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()
        member = await self._repo.get_member(room_id=room_id, user_id=user_id)
        if member is None:
            raise ChatRoomForbiddenError()
        return room

    async def list_my_rooms(self, *, user_id: int) -> list[RoomView]:
        rooms = await self._repo.list_user_rooms(user_id=user_id)
        return [_to_room_view(r) for r in rooms]

    # ---- Messages ----
    async def send_message(
        self,
        *,
        sender_id: int,
        room_id: int,
        payload: MessageCreate,
    ) -> MessageView:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()
        member = await self._repo.get_member(room_id=room_id, user_id=sender_id)
        if member is None:
            raise ChatRoomForbiddenError()

        m = await self._repo.create_message(
            room_id=room_id,
            sender_id=sender_id,
            body=payload.body,
            media_id=payload.media_id,
        )

        # Best-effort WS fan-out to the other room members.
        try:
            await self._publish_message_event(room_id=room_id, message=m, sender_id=sender_id)
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "chat_ws_publish_failed",
                message_id=m.id,
                error=type(exc).__name__,
            )

        logger.info(
            "chat_message_sent",
            message_id=m.id,
            room_id=room_id,
            sender_id=sender_id,
        )
        return _to_message_view(m)

    async def _publish_message_event(
        self, *, room_id: int, message: Message, sender_id: int
    ) -> None:
        from social_api.core.feature_flags import get_flags

        if not get_flags().is_enabled("ws_enabled"):
            return

        from social_api.cache.redis import get_redis
        from social_api.realtime.channels import publish_to_user
        from social_api.realtime.events import build_event

        members = await self._repo.list_members(room_id=room_id)
        payload = build_event(
            type_="notification",  # envelope type; client routes by "kind"
            data={
                "kind": "chat_message",
                "room_id": room_id,
                "message": _to_message_view(message).model_dump(mode="json"),
                "sender_id": sender_id,
            },
        )
        redis = get_redis()
        for m in members:
            if m.user_id == sender_id:
                continue
            await publish_to_user(redis=redis, user_id=m.user_id, payload=payload)

    async def list_messages(
        self,
        *,
        user_id: int,
        room_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> MessagePage:
        await self.get_room_for_member(user_id=user_id, room_id=room_id)
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None

        rows = await self._repo.list_messages(
            room_id=room_id,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        return MessagePage(
            items=[_to_message_view(m) for m in rows],
            next_cursor=next_cursor,
        )

    async def delete_message(self, *, actor: User, message_id: int) -> None:
        m = await self._repo.get_message(message_id)
        if m is None:
            raise MessageNotFoundError()

        is_owner = m.sender_id == actor.id
        is_staff = actor.role in (UserRole.MODERATOR, UserRole.ADMIN)
        if not (is_owner or is_staff):
            raise MessageForbiddenError()

        from datetime import UTC

        m.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save_message(m)
        logger.info(
            "chat_message_deleted",
            message_id=message_id,
            actor_id=actor.id,
            as_staff=is_staff and not is_owner,
        )

    # ---- Read receipts ----
    async def mark_read(self, *, user_id: int, room_id: int, message_id: int) -> MemberReadState:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()

        latest = await self._repo.latest_message_id_in_room(room_id=room_id)
        if latest is None or message_id > latest:
            raise ReadReceiptInvalidError()

        msg = await self._repo.get_message(message_id)
        if msg is None or msg.room_id != room_id:
            raise ReadReceiptInvalidError()

        member = await self._repo.update_last_read(
            room_id=room_id, user_id=user_id, message_id=message_id
        )
        if member is None:
            raise ChatRoomForbiddenError()

        return MemberReadState(
            user_id=user_id,
            last_read_message_id=member.last_read_message_id,
        )

    async def list_read_receipts(self, *, user_id: int, room_id: int) -> ReadReceiptsList:
        await self.get_room_for_member(user_id=user_id, room_id=room_id)
        members = await self._repo.list_members(room_id=room_id)
        return ReadReceiptsList(
            members=[
                MemberReadState(
                    user_id=m.user_id,
                    last_read_message_id=m.last_read_message_id,
                )
                for m in members
            ]
        )

    async def unread_count(self, *, user_id: int, room_id: int) -> UnreadCount:
        member = await self._repo.get_member(room_id=room_id, user_id=user_id)
        if member is None:
            raise ChatRoomForbiddenError()
        n = await self._repo.unread_count(
            room_id=room_id,
            user_id=user_id,
            since_message_id=member.last_read_message_id,
        )
        return UnreadCount(unread=n)

    # ---- Typing (best-effort, no DB) ----
    async def publish_typing(self, *, user_id: int, room_id: int) -> None:
        # Verify membership (don't let non-members spam rooms).
        await self.get_room_for_member(user_id=user_id, room_id=room_id)

        from social_api.cache.redis import get_redis
        from social_api.realtime.events import build_event

        try:
            redis = get_redis()
            payload = build_event(
                type_="presence",
                data={
                    "kind": "typing",
                    "room_id": room_id,
                    "user_id": user_id,
                },
            )
            await redis.publish(f"ws:room:{room_id}", payload)
        except Exception as exc:  # pragma: no cover
            logger.debug(
                "typing_publish_failed",
                room_id=room_id,
                error=type(exc).__name__,
            )
