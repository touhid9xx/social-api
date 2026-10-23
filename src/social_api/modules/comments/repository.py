"""Comments repository."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.comments.models import Comment


class CommentsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_by_id(self, comment_id: int) -> Comment | None:
        stmt = select(Comment).where(Comment.id == comment_id, Comment.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create(
        self,
        *,
        post_id: int,
        author_id: int,
        parent_id: int | None,
        depth: int,
        body: str,
    ) -> Comment:
        c = Comment(
            post_id=post_id,
            author_id=author_id,
            parent_id=parent_id,
            depth=depth,
            body=body,
        )
        self._s.add(c)
        await self._s.flush()
        await self._s.refresh(c)
        return c

    async def save(self, comment: Comment) -> None:
        await self._s.flush()

    async def list_for_post(
        self,
        *,
        post_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Comment]:
        stmt = select(Comment).where(
            Comment.post_id == post_id,
            Comment.parent_id.is_(None),  # top-level only for pagination
            Comment.deleted_at.is_(None),
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Comment.created_at < cursor_ts,
                    and_(Comment.created_at == cursor_ts, Comment.id < cursor_id),
                )
            )
        stmt = stmt.order_by(Comment.created_at.desc(), Comment.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def list_replies(self, *, parent_id: int) -> list[Comment]:
        stmt = (
            select(Comment)
            .where(Comment.parent_id == parent_id, Comment.deleted_at.is_(None))
            .order_by(Comment.created_at.asc(), Comment.id.asc())
            .limit(20)  # cap
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def increment_post_comment_count(self, *, post_id: int) -> None:
        from social_api.modules.posts.models import Post

        await self._s.execute(
            update(Post).where(Post.id == post_id).values(comment_count=Post.comment_count + 1)
        )

    async def decrement_post_comment_count(self, *, post_id: int) -> None:
        from social_api.modules.posts.models import Post

        await self._s.execute(
            update(Post).where(Post.id == post_id).values(comment_count=Post.comment_count - 1)
        )
