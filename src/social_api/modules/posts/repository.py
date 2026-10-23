"""Posts repository."""

from __future__ import annotations

from datetime import datetime
from typing import NamedTuple

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.posts.models import Post


class PostRow(NamedTuple):
    post: Post


class PostsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_by_id(self, post_id: int) -> Post | None:
        stmt = select(Post).where(Post.id == post_id, Post.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create(self, *, author_id: int, body: str, visibility: str) -> Post:
        from social_api.modules.users.models import Visibility

        post = Post(author_id=author_id, body=body, visibility=Visibility(visibility))
        self._s.add(post)
        await self._s.flush()
        await self._s.refresh(post)
        return post

    async def save(self, post: Post) -> None:
        await self._s.flush()

    async def list_by_author(
        self,
        *,
        author_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Post]:
        stmt = select(Post).where(Post.author_id == author_id, Post.deleted_at.is_(None))
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Post.created_at < cursor_ts,
                    and_(Post.created_at == cursor_ts, Post.id < cursor_id),
                )
            )
        stmt = stmt.order_by(Post.created_at.desc(), Post.id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())
