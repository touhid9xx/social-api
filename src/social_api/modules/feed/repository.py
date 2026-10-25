"""Feed repository — read-side queries for feed generation."""

from __future__ import annotations

from sqlalchemy import and_, case, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.follows.models import Block, Follow, Mute
from social_api.modules.posts.models import Post


class FeedRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def fetch_feed_posts_for_rebuild(
        self,
        *,
        user_id: int,
        cap: int,
    ) -> list[Post]:
        """
        Fetch newest posts from author_id IN (following + {self}), respecting
        blocks (both directions) and mutes (viewer's own mutes).
        Returns newest first, limited to `cap`.
        """
        followees_stmt = select(Follow.followee_id).where(Follow.follower_id == user_id)
        blocked_stmt = select(Block.blocked_id).where(Block.blocker_id == user_id)
        blocked_by_stmt = select(Block.blocker_id).where(Block.blocked_id == user_id)
        muted_stmt = select(Mute.muted_id).where(Mute.muter_id == user_id)

        author_ids_stmt = followees_stmt.union(select(literal(user_id)))

        stmt = (
            select(Post)
            .where(
                Post.deleted_at.is_(None),
                Post.author_id.in_(author_ids_stmt),
                ~Post.author_id.in_(blocked_stmt),
                ~Post.author_id.in_(blocked_by_stmt),
                ~Post.author_id.in_(muted_stmt),
            )
            .order_by(Post.created_at.desc(), Post.id.desc())
            .limit(cap)
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def fetch_posts_by_ids(self, *, post_ids: list[int]) -> list[Post]:
        if not post_ids:
            return []
        stmt = select(Post).where(Post.id.in_(post_ids), Post.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        posts = {p.id: p for p in res.scalars().all()}
        return [posts[pid] for pid in post_ids if pid in posts]

    async def following_ids(self, *, user_id: int) -> list[int]:
        stmt = select(Follow.followee_id).where(Follow.follower_id == user_id)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def follower_ids(self, *, user_id: int) -> list[int]:
        stmt = select(Follow.follower_id).where(Follow.followee_id == user_id)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def is_blocked_between(self, a: int, b: int) -> bool:
        stmt = (
            select(literal(1))
            .where(
                or_(
                    and_(Block.blocker_id == a, Block.blocked_id == b),
                    and_(Block.blocker_id == b, Block.blocked_id == a),
                )
            )
            .limit(1)
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none() is not None

    async def blocked_with_author_ids(self, *, viewer_id: int, author_ids: list[int]) -> set[int]:
        """
        Return the subset of `author_ids` that have a block relationship
        with `viewer_id` (either direction). Single query.
        """
        if not author_ids:
            return set()
        # The "other side" of each block involving viewer_id
        stmt = select(
            case(
                (Block.blocker_id == viewer_id, Block.blocked_id),
                else_=Block.blocker_id,
            )
        ).where(
            or_(
                and_(
                    Block.blocker_id == viewer_id,
                    Block.blocked_id.in_(author_ids),
                ),
                and_(
                    Block.blocked_id == viewer_id,
                    Block.blocker_id.in_(author_ids),
                ),
            )
        )
        res = await self._s.execute(stmt)
        return set(res.scalars().all())
