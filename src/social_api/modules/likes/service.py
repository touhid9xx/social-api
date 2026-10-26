"""Likes service."""

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
from social_api.modules.comments.repository import CommentsRepository
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.likes.schemas import LikeUser, LikeUserPage
from social_api.modules.posts.exceptions import LikeTargetNotFoundError
from social_api.modules.posts.repository import PostsRepository
from social_api.modules.users.repository import (
    ProfileRepository as UsersProfileRepository,
)

logger = get_logger(__name__)


class LikesService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = LikesRepository(session)
        self._posts = PostsRepository(session)
        self._comments = CommentsRepository(session)
        self._profiles = UsersProfileRepository(session)

    async def like(self, *, user_id: int, target_type: str, target_id: int) -> None:
        if target_type == "post":
            target = await self._posts.get_by_id(target_id)
            if target is None:
                raise LikeTargetNotFoundError()
            author_id = target.author_id
        else:
            target2 = await self._comments.get_by_id(target_id)
            if target2 is None:
                raise LikeTargetNotFoundError()
            author_id = target2.author_id

        added = await self._repo.add(user_id=user_id, target_type=target_type, target_id=target_id)
        if not added:
            return  # already liked -> no notification

        logger.info(
            "liked",
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
        )
        try:
            from social_api.modules.notifications.service import (
                NotificationsService,
            )

            await NotificationsService(self._s).notify_like(
                liker_id=user_id,
                target_author_id=author_id,
                target_type=target_type,
                target_id=target_id,
            )
        except Exception as exc:  # pragma: no cover
            logger.warning(
                "notify_like_failed",
                user_id=user_id,
                error=type(exc).__name__,
            )

    async def unlike(self, *, user_id: int, target_type: str, target_id: int) -> None:
        await self._repo.remove(user_id=user_id, target_type=target_type, target_id=target_id)

    async def list_likers(
        self,
        *,
        target_type: str,
        target_id: int,
        cursor: str | None,
        limit: int | None,
    ) -> LikeUserPage:
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

        rows = await self._repo.list_users(
            target_type=target_type,
            target_id=target_id,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.user_id])

        items: list[LikeUser] = []
        for r in rows:
            p = await self._profiles.get_by_user_id(r.user_id)
            items.append(
                LikeUser(
                    user_id=r.user_id,
                    display_name=p.display_name if p else None,
                    avatar_url=p.avatar_url if p else None,
                )
            )
        return LikeUserPage(items=items, next_cursor=next_cursor)
