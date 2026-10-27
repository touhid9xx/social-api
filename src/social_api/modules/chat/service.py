"""Chat service."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.repository import UserRepository
from social_api.modules.chat.exceptions import (
    AdminRequiredError,
    AlreadyMemberError,
    CannotChatWithSelfError,
    ChatRoomForbiddenError,
    ChatRoomNotFoundError,
    DirectChatNotAllowedError,
    LastAdminCannotLeaveError,
    MediaAlreadyUsedError,
    MediaNotOwnedError,
    MessageForbiddenError,
    MessageNotFoundError,
    ReadReceiptInvalidError,
    UserBlockedChatError,
)
from social_api.modules.chat.models import (
    ChatRoom,
    MemberRole,
    Message,
    RoomType,
)
from social_api.modules.chat.repository import ChatRepository
from social_api.modules.chat.schemas import (
    DirectRoomCreate,
    GroupRoomCreate,
    MemberReadState,
    MessageCreate,
    MessagePage,
    MessageView,
    ReadReceiptsList,
    RoomMembersList,
    RoomMemberView,
    RoomUpdate,
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
        # `version > 1` — monotone edit signal, immune to MySQL DATETIME
        # second-precision truncation that makes `updated_at > created_at`
        # fail on fast edits. Same fix as posts/comments.
        is_edited=m.version > 1,
    )


class ChatService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = ChatRepository(session)
        self._users = UserRepository(session)
        self._follows = FollowsRepository(session)

        from social_api.modules.media.repository import MediaRepository

        self._media_repo = MediaRepository(session)

    # ---- Rooms (direct) ----
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

    # ---- Rooms (group) ----
    async def create_group(self, *, creator_id: int, payload: GroupRoomCreate) -> RoomView:
        # Filter out creator (auto-added as admin).
        member_ids = [m for m in payload.member_ids if m != creator_id]

        # Verify all members exist and are not blocked with creator.
        for uid in member_ids:
            target = await self._users.get_by_id(uid)
            if target is None:
                raise ChatRoomNotFoundError()
            if await self._follows.blocked_either_direction(creator_id, uid):
                raise UserBlockedChatError()

        room = await self._repo.create_group_room(
            title=payload.title,
            admin_id=creator_id,
            member_ids=member_ids,
        )
        logger.info(
            "chat_group_created",
            room_id=room.id,
            admin_id=creator_id,
            members=len(member_ids) + 1,
        )

        # Audit — creating a persistent group with N members is a
        # state-changing administrative action worth a forensic trail.
        await AuditService(self._s).write(
            actor_id=creator_id,
            action="CREATE_CHAT_GROUP",
            entity="chat_room",
            entity_id=room.id,
            after={
                "title": room.title,
                "member_ids": member_ids,
            },
        )
        return _to_room_view(room)

    async def update_title(self, *, user_id: int, room_id: int, payload: RoomUpdate) -> RoomView:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()
        if room.type != RoomType.GROUP:
            raise DirectChatNotAllowedError()

        member = await self._repo.get_member(room_id=room_id, user_id=user_id)
        if member is None:
            raise ChatRoomForbiddenError()
        if member.role != MemberRole.ADMIN:
            raise AdminRequiredError()

        if room.version != payload.version:
            from social_api.modules.users.exceptions import (
                OptimisticLockError,
            )

            raise OptimisticLockError(
                detail={
                    "current_version": room.version,
                    "current": _to_room_view(room).model_dump(mode="json"),
                }
            )

        old_title = room.title
        room.title = payload.title
        room.version += 1
        await self._repo.save_room(room)
        logger.info(
            "chat_group_title_updated",
            room_id=room_id,
            actor_id=user_id,
        )

        # Audit — admin renaming a group is a staff-like action.
        await AuditService(self._s).write(
            actor_id=user_id,
            action="UPDATE_CHAT_GROUP_TITLE",
            entity="chat_room",
            entity_id=room_id,
            before={"title": old_title},
            after={"title": room.title},
        )
        return _to_room_view(room)

    async def list_members(self, *, user_id: int, room_id: int) -> RoomMembersList:
        await self.get_room_for_member(user_id=user_id, room_id=room_id)
        members = await self._repo.list_members(room_id=room_id)
        return RoomMembersList(
            members=[
                RoomMemberView(
                    user_id=m.user_id,
                    role=m.role.value,
                    joined_at=m.joined_at,
                )
                for m in members
            ]
        )

    async def add_member(self, *, actor_id: int, room_id: int, target_id: int) -> RoomMemberView:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()
        if room.type != RoomType.GROUP:
            raise DirectChatNotAllowedError()

        actor = await self._repo.get_member(room_id=room_id, user_id=actor_id)
        if actor is None:
            raise ChatRoomForbiddenError()
        if actor.role != MemberRole.ADMIN:
            raise AdminRequiredError()

        if await self._repo.get_member(room_id=room_id, user_id=target_id):
            raise AlreadyMemberError()

        target = await self._users.get_by_id(target_id)
        if target is None:
            raise ChatRoomNotFoundError()
        if await self._follows.blocked_either_direction(actor_id, target_id):
            raise UserBlockedChatError()

        m = await self._repo.add_member(
            room_id=room_id,
            user_id=target_id,
            role=MemberRole.MEMBER,
        )
        logger.info(
            "chat_member_added",
            room_id=room_id,
            user_id=target_id,
            by=actor_id,
        )

        # Audit — admin adding a member is a state-changing admin action.
        await AuditService(self._s).write(
            actor_id=actor_id,
            action="ADD_CHAT_MEMBER",
            entity="chat_room",
            entity_id=room_id,
            after={"target_user_id": target_id, "role": "member"},
        )
        return RoomMemberView(
            user_id=m.user_id,
            role=m.role.value,
            joined_at=m.joined_at,
        )

    async def remove_member(self, *, actor_id: int, room_id: int, target_id: int) -> None:
        room = await self._repo.get_room(room_id)
        if room is None:
            raise ChatRoomNotFoundError()
        if room.type != RoomType.GROUP:
            raise DirectChatNotAllowedError()

        actor = await self._repo.get_member(room_id=room_id, user_id=actor_id)
        if actor is None:
            raise ChatRoomForbiddenError()

        # Self-removal (leave) is allowed for any member; removing
        # others requires admin.
        if target_id != actor_id and actor.role != MemberRole.ADMIN:
            raise AdminRequiredError()

        target = await self._repo.get_member(room_id=room_id, user_id=target_id)
        if target is None:
            raise ChatRoomNotFoundError()

        # Last-admin rule: if target is an admin and only 1 admin left
        # and there are other members, refuse — the room would be
        # orphaned. Last-member-leaving case is allowed (room gets
        # soft-deleted below).
        if target.role == MemberRole.ADMIN:
            admin_count = await self._repo.count_admins(room_id=room_id)
            if admin_count <= 1:
                member_count = await self._repo.count_members(room_id=room_id)
                if member_count > 1:
                    raise LastAdminCannotLeaveError()

        removed = await self._repo.remove_member(room_id=room_id, user_id=target_id)
        if not removed:
            raise ChatRoomNotFoundError()

        # If room now empty -> soft-delete.
        remaining = await self._repo.count_members(room_id=room_id)
        if remaining == 0:
            await self._repo.soft_delete_room(room_id=room_id)
            logger.info("chat_room_auto_deleted", room_id=room_id)

        logger.info(
            "chat_member_removed",
            room_id=room_id,
            user_id=target_id,
            by=actor_id,
        )

        # Audit — self-leave vs admin-kick are both state-changing; the
        # is_self flag lets forensics distinguish "left voluntarily" from
        # "removed by admin".
        is_self_leave = target_id == actor_id
        await AuditService(self._s).write(
            actor_id=actor_id,
            action="REMOVE_CHAT_MEMBER",
            entity="chat_room",
            entity_id=room_id,
            after={
                "target_user_id": target_id,
                "is_self_leave": is_self_leave,
            },
        )

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

        # Media validation (if any).
        if payload.media_id is not None:
            await self._validate_media_for_message(media_id=payload.media_id, sender_id=sender_id)

        m = await self._repo.create_message(
            room_id=room_id,
            sender_id=sender_id,
            body=payload.body,
            media_id=payload.media_id,
        )

        # Bind media to message (prevents reuse).
        if payload.media_id is not None:
            await self._attach_media_to_message(media_id=payload.media_id, message_id=m.id)

        # WS push (best-effort).
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
            has_media=payload.media_id is not None,
        )
        return _to_message_view(m)

    async def _validate_media_for_message(self, *, media_id: int, sender_id: int) -> None:
        media = await self._media_repo.get_by_id(media_id)
        if media is None:
            raise MediaNotOwnedError()
        if media.owner_id != sender_id:
            raise MediaNotOwnedError()
        # Bind-collision guard: media may be attached to a post OR a
        # message already.
        if getattr(media, "post_id", None) is not None:
            raise MediaAlreadyUsedError()
        if getattr(media, "message_id", None) is not None:
            raise MediaAlreadyUsedError()

    async def _attach_media_to_message(self, *, media_id: int, message_id: int) -> None:
        from sqlalchemy.exc import IntegrityError

        media = await self._media_repo.get_by_id(media_id)
        if media is None:
            raise MediaNotOwnedError()
        media.message_id = message_id
        try:
            await self._media_repo.save(media)
        except IntegrityError:
            raise MediaAlreadyUsedError() from None

    async def _publish_message_event(
        self, *, room_id: int, message: Message, sender_id: int
    ) -> None:
        from social_api.core.feature_flags import get_flags

        if not get_flags().is_enabled("ws_enabled"):
            return

        from social_api.cache.redis import get_redis, guarded
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

        async def _publish_all() -> int:
            delivered = 0
            for m in members:
                if m.user_id == sender_id:
                    continue
                delivered += await publish_to_user(redis=redis, user_id=m.user_id, payload=payload)
            return delivered

        await guarded(
            _publish_all,
            default=0,
            op="chat_publish_message",
        )

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

        m.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save_message(m)
        logger.info(
            "chat_message_deleted",
            message_id=message_id,
            actor_id=actor.id,
            as_staff=is_staff and not is_owner,
        )

        # Audit — deleting a message is destructive. Self-delete vs
        # staff-delete are both sensitive (content disappears); as_staff
        # flag captures the distinction for forensic review.
        await AuditService(self._s).write(
            actor_id=actor.id,
            action="DELETE_CHAT_MESSAGE",
            entity="message",
            entity_id=m.id,
            after={
                "room_id": m.room_id,
                "sender_id": m.sender_id,
                "as_staff": is_staff and not is_owner,
            },
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
        """Broadcast a typing indicator to a room's WebSocket subscribers.

        Best-effort: no DB, no WS required. Trips redis_breaker on Redis
        failure so subsequent publishes fail fast during an outage.
        """
        # Verify membership (don't let non-members spam rooms).
        await self.get_room_for_member(user_id=user_id, room_id=room_id)

        from social_api.cache.redis import get_redis, guarded
        from social_api.realtime.events import build_event

        redis = get_redis()
        payload = build_event(
            type_="presence",
            data={
                "kind": "typing",
                "room_id": room_id,
                "user_id": user_id,
            },
        )

        await guarded(
            lambda: redis.publish(f"ws:room:{room_id}", payload),
            default=0,
            op="chat_publish_typing",
        )
