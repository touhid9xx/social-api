"""Notifications service."""

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
from social_api.modules.follows.repository import FollowsRepository
from social_api.modules.notifications.exceptions import (
    NotificationForbiddenError,
    NotificationNotFoundError,
)
from social_api.modules.notifications.models import Notification
from social_api.modules.notifications.repository import (
    NotificationsRepository,
)
from social_api.modules.notifications.schemas import (
    MarkReadResponse,
    NotificationPage,
    NotificationView,
    UnreadCount,
)

logger = get_logger(__name__)


def _to_view(n: Notification) -> NotificationView:
    return NotificationView(
        id=n.id,
        type=n.type.value,
        target_type=n.target_type.value,
        target_id=n.target_id,
        actor_id=n.actor_id,
        is_read=n.is_read,
        read_at=n.read_at,
        preview=n.preview,
        created_at=n.created_at,
    )


class NotificationsService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = NotificationsRepository(session)
        self._follows = FollowsRepository(session)

    # ---- Trigger API (called by other services) ----
    async def notify_follow(self, *, follower_id: int, followee_id: int) -> None:
        if follower_id == followee_id:
            return
        if await self._follows.blocked_either_direction(follower_id, followee_id):
            return
        await self._safe_create(
            user_id=followee_id,
            actor_id=follower_id,
            type_="follow",
            target_type="user",
            target_id=follower_id,
        )

    async def notify_like(
        self,
        *,
        liker_id: int,
        target_author_id: int,
        target_type: str,  # "post" | "comment"
        target_id: int,
    ) -> None:
        if liker_id == target_author_id:
            return
        if await self._follows.blocked_either_direction(liker_id, target_author_id):
            return
        ntype = "like_post" if target_type == "post" else "like_comment"
        await self._safe_create(
            user_id=target_author_id,
            actor_id=liker_id,
            type_=ntype,
            target_type=target_type,
            target_id=target_id,
        )

    async def notify_comment(
        self,
        *,
        commenter_id: int,
        post_author_id: int,
        post_id: int,
        parent_author_id: int | None,
        parent_comment_id: int | None,
        excerpt: str,
    ) -> None:
        # Reply -> notify parent author; top-level -> notify post author.
        if parent_author_id is not None and parent_comment_id is not None:
            if commenter_id == parent_author_id:
                return
            if await self._follows.blocked_either_direction(commenter_id, parent_author_id):
                return
            await self._safe_create(
                user_id=parent_author_id,
                actor_id=commenter_id,
                type_="comment_reply",
                target_type="comment",
                target_id=parent_comment_id,
                preview=excerpt,
            )
            return

        if commenter_id == post_author_id:
            return
        if await self._follows.blocked_either_direction(commenter_id, post_author_id):
            return
        await self._safe_create(
            user_id=post_author_id,
            actor_id=commenter_id,
            type_="comment_post",
            target_type="post",
            target_id=post_id,
            preview=excerpt,
        )

    # ---- Internal: create + best-effort WS push ----
    async def _safe_create(
        self,
        *,
        user_id: int,
        actor_id: int,
        type_: str,
        target_type: str,
        target_id: int,
        preview: str | None = None,
    ) -> None:
        """Create a notification row (idempotent via daily dedupe) + WS push.

        The notification row is the source of truth. The WS push is a
        best-effort delivery optimisation: if Redis is down, no subscriber
        is connected, or the flag is off, the client will still see the
        notification on the next inbox fetch / unread-count poll.
        """
        try:
            row = await self._repo.create(
                user_id=user_id,
                actor_id=actor_id,
                type_=type_,
                target_type=target_type,
                target_id=target_id,
                preview=preview,
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "notification_create_failed",
                user_id=user_id,
                type=type_,
                error=type(exc).__name__,
            )
            return

        if row is None:
            # Dedupe hit (unique index on user,actor,type,target,day_bucket).
            # Nothing new to push.
            return

        logger.debug(
            "notification_created",
            notification_id=row.id,
            user_id=user_id,
            type=type_,
        )

        # ---- Best-effort WS push (M14) ----
        try:
            from social_api.modules.notifications.realtime import (
                push_notification,
            )

            view = _to_view(row)
            await push_notification(
                user_id=user_id,
                notification_payload=view.model_dump(mode="json"),
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "ws_push_dispatch_failed",
                notification_id=row.id,
                error=type(exc).__name__,
            )

    # ---- Read API ----
    async def list_inbox(
        self,
        *,
        user_id: int,
        unread_only: bool,
        cursor: str | None,
        limit: int | None,
    ) -> NotificationPage:
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

        rows = await self._repo.list_for_user(
            user_id=user_id,
            unread_only=unread_only,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        return NotificationPage(
            items=[_to_view(n) for n in rows],
            next_cursor=next_cursor,
        )

    async def unread_count(self, *, user_id: int) -> UnreadCount:
        n = await self._repo.unread_count(user_id=user_id)
        return UnreadCount(unread=n)

    async def mark_read(self, *, user_id: int, notif_id: int) -> NotificationView:
        was_unread: bool | None = None
        row = await self._repo.get_by_id(notif_id)
        if row is not None and row.user_id == user_id:
            was_unread = not row.is_read

        updated = await self._repo.mark_read(user_id=user_id, notif_id=notif_id)
        if updated is None:
            raise NotificationNotFoundError()

        if was_unread:
            try:
                from social_api.modules.notifications.realtime import (
                    push_unread_delta,
                )

                await push_unread_delta(user_id=user_id, delta=-1)
            except Exception as exc:  # pragma: no cover — defensive
                logger.warning(
                    "ws_push_read_failed",
                    notification_id=notif_id,
                    error=type(exc).__name__,
                )

        return _to_view(updated)

    async def mark_all_read(self, *, user_id: int) -> MarkReadResponse:
        n = await self._repo.mark_all_read(user_id=user_id)
        if n > 0:
            try:
                from social_api.modules.notifications.realtime import (
                    push_unread_reset,
                )

                await push_unread_reset(user_id=user_id)
            except Exception as exc:  # pragma: no cover — defensive
                logger.warning(
                    "ws_push_read_all_failed",
                    user_id=user_id,
                    error=type(exc).__name__,
                )
        return MarkReadResponse(updated=n)

    async def delete(self, *, user_id: int, notif_id: int) -> None:
        ok = await self._repo.soft_delete(user_id=user_id, notif_id=notif_id)
        if not ok:
            raise NotificationForbiddenError()
