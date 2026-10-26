"""GDPR repository: deletion requests + data export queries."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.chat.models import ChatRoom, ChatRoomMember, Message
from social_api.modules.comments.models import Comment
from social_api.modules.follows.models import Block, Follow, Mute
from social_api.modules.gdpr.models import (
    DeletionRequest,
    DeletionStatus,
)
from social_api.modules.likes.models import Like
from social_api.modules.moderation.models import Report
from social_api.modules.notifications.models import Notification
from social_api.modules.posts.models import Post
from social_api.modules.users.models import Profile, UserConsent


class DeletionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_active_for_user(self, user_id: int) -> DeletionRequest | None:
        stmt = select(DeletionRequest).where(
            DeletionRequest.user_id == user_id,
            DeletionRequest.status == DeletionStatus.SCHEDULED,
            DeletionRequest.deleted_at.is_(None),
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create(
        self,
        *,
        user_id: int,
        scheduled_hard_delete_at: datetime,
    ) -> DeletionRequest:
        row = DeletionRequest(
            user_id=user_id,
            scheduled_hard_delete_at=scheduled_hard_delete_at,
            status=DeletionStatus.SCHEDULED,
        )
        self._s.add(row)
        await self._s.flush()
        await self._s.refresh(row)
        return row

    async def cancel(self, row: DeletionRequest) -> None:
        row.status = DeletionStatus.CANCELLED
        row.cancelled_at = datetime.now(UTC).replace(tzinfo=None)
        await self._s.flush()

    async def mark_completed(self, *, request_id: int) -> bool:
        """Atomic: only transitions from SCHEDULED."""
        stmt = (
            update(DeletionRequest)
            .where(
                DeletionRequest.id == request_id,
                DeletionRequest.status == DeletionStatus.SCHEDULED,
            )
            .values(
                status=DeletionStatus.COMPLETED,
                completed_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        res = await self._s.execute(stmt)
        rowcount = getattr(res, "rowcount", 0)
        return isinstance(rowcount, int) and rowcount > 0

    async def list_due(self, *, cutoff: datetime, limit: int = 100) -> list[DeletionRequest]:
        """Beat: scheduled requests past their hard-delete time."""
        stmt = (
            select(DeletionRequest)
            .where(
                DeletionRequest.status == DeletionStatus.SCHEDULED,
                DeletionRequest.scheduled_hard_delete_at < cutoff,
                DeletionRequest.deleted_at.is_(None),
            )
            .order_by(DeletionRequest.scheduled_hard_delete_at.asc())
            .limit(limit)
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())


class ExportRepository:
    """Read-only queries for the export endpoint."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_profile(self, user_id: int) -> Profile | None:
        stmt = select(Profile).where(Profile.user_id == user_id)
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def list_consents(self, user_id: int) -> list[UserConsent]:
        stmt = select(UserConsent).where(UserConsent.user_id == user_id)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_posts(self, user_id: int) -> list[Post]:
        stmt = select(Post).where(Post.author_id == user_id).order_by(Post.created_at.desc())
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_comments(self, user_id: int) -> list[Comment]:
        stmt = (
            select(Comment).where(Comment.author_id == user_id).order_by(Comment.created_at.desc())
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_likes(self, user_id: int) -> list[Like]:
        stmt = select(Like).where(Like.user_id == user_id).order_by(Like.created_at.desc())
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_follows(self, user_id: int) -> tuple[list[int], list[int]]:
        following_stmt = select(Follow.followee_id).where(Follow.follower_id == user_id)
        followers_stmt = select(Follow.follower_id).where(Follow.followee_id == user_id)
        following = list((await self._s.execute(following_stmt)).scalars().all())
        followers = list((await self._s.execute(followers_stmt)).scalars().all())
        return following, followers

    async def list_blocks(self, user_id: int) -> list[int]:
        stmt = select(Block.blocked_id).where(Block.blocker_id == user_id)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_mutes(self, user_id: int) -> list[int]:
        stmt = select(Mute.muted_id).where(Mute.muter_id == user_id)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_chat_rooms(self, user_id: int) -> list[ChatRoom]:
        stmt = (
            select(ChatRoom)
            .join(
                ChatRoomMember,
                ChatRoomMember.room_id == ChatRoom.id,
            )
            .where(ChatRoomMember.user_id == user_id)
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_messages_in_room(self, room_id: int) -> list[Message]:
        stmt = select(Message).where(Message.room_id == room_id).order_by(Message.created_at.asc())
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_notifications(self, user_id: int) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_reports_made(self, user_id: int) -> list[Report]:
        stmt = (
            select(Report).where(Report.reporter_id == user_id).order_by(Report.created_at.desc())
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())
