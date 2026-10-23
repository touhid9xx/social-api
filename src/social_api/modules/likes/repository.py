"""Likes repository."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, delete, exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.likes.models import Like, LikeTarget
from social_api.modules.posts.models import Post


class LikesRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def add(self, *, user_id: int, target_type: str, target_id: int) -> bool:
        """
        Insert like row + increment counter atomically.

        Returns True if new like, False if already liked (idempotent).
        """
        tt = LikeTarget(target_type)
        like = Like(user_id=user_id, target_type=tt, target_id=target_id)
        self._s.add(like)
        try:
            await self._s.flush()
        except Exception:
            # Unique violation -> already liked
            await self._s.rollback()
            return False

        # Increment counter
        if tt == LikeTarget.POST:
            await self._s.execute(
                update(Post).where(Post.id == target_id).values(like_count=Post.like_count + 1)
            )
        else:
            from social_api.modules.comments.models import Comment

            await self._s.execute(
                update(Comment)
                .where(Comment.id == target_id)
                .values(like_count=Comment.like_count + 1)
            )
        return True

    async def remove(self, *, user_id: int, target_type: str, target_id: int) -> bool:
        tt = LikeTarget(target_type)
        stmt = delete(Like).where(
            Like.user_id == user_id,
            Like.target_type == tt,
            Like.target_id == target_id,
        )
        res = await self._s.execute(stmt)
        if (res.rowcount or 0) == 0:  # type: ignore
            return False

        if tt == LikeTarget.POST:
            await self._s.execute(
                update(Post).where(Post.id == target_id).values(like_count=Post.like_count - 1)
            )
        else:
            from social_api.modules.comments.models import Comment

            await self._s.execute(
                update(Comment)
                .where(Comment.id == target_id)
                .values(like_count=Comment.like_count - 1)
            )
        return True

    async def exists(self, *, user_id: int, target_type: str, target_id: int) -> bool:
        stmt = select(
            exists().where(
                Like.user_id == user_id,
                Like.target_type == LikeTarget(target_type),
                Like.target_id == target_id,
            )
        )
        res = await self._s.execute(stmt)
        return bool(res.scalar())

    async def exists_batch(
        self,
        *,
        user_id: int,
        target_type: str,
        target_ids: list[int],
    ) -> set[int]:
        if not target_ids:
            return set()
        stmt = select(Like.target_id).where(
            Like.user_id == user_id,
            Like.target_type == LikeTarget(target_type),
            Like.target_id.in_(target_ids),
        )
        res = await self._s.execute(stmt)
        return set(res.scalars().all())

    async def list_users(
        self,
        *,
        target_type: str,
        target_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Like]:
        tt = LikeTarget(target_type)
        stmt = select(Like).where(Like.target_type == tt, Like.target_id == target_id)
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Like.created_at < cursor_ts,
                    and_(Like.created_at == cursor_ts, Like.user_id < cursor_id),
                )
            )
        stmt = stmt.order_by(Like.created_at.desc(), Like.user_id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())
