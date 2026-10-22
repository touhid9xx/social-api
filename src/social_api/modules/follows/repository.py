"""Follows repository — all graph mutations + queries."""

from __future__ import annotations

from datetime import datetime
from typing import Any, NamedTuple

from sqlalchemy import (
    CursorResult,
    and_,
    delete,
    exists,
    func,
    or_,
    select,
)
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.follows.models import Block, Follow, Mute
from social_api.modules.users.models import Profile


class FollowEdge(NamedTuple):
    user_id: int
    display_name: str | None
    avatar_url: str | None
    followed_at: datetime


async def _exec_delete(session: AsyncSession, stmt: Any) -> int:
    """Execute a DELETE and return affected row count."""
    res: CursorResult[Any] = await session.execute(stmt)  # type: ignore[assignment]
    return int(res.rowcount or 0)


class FollowsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    # ---- Follow ----
    async def follow(self, *, follower_id: int, followee_id: int) -> None:
        # Idempotent via MySQL INSERT IGNORE on the composite PK.
        # No IntegrityError, no rollback, no transaction abort.
        stmt = mysql_insert(Follow).values(
            follower_id=follower_id,
            followee_id=followee_id,
            created_at=func.now(),
        )
        stmt = stmt.prefix_with("IGNORE")
        await self._s.execute(stmt)

    async def unfollow(self, *, follower_id: int, followee_id: int) -> bool:
        stmt = delete(Follow).where(
            Follow.follower_id == follower_id,
            Follow.followee_id == followee_id,
        )
        return await _exec_delete(self._s, stmt) > 0

    async def is_following(self, *, follower_id: int, followee_id: int) -> bool:
        stmt = select(
            exists().where(
                Follow.follower_id == follower_id,
                Follow.followee_id == followee_id,
            )
        )
        res = await self._s.execute(stmt)
        return bool(res.scalar())

    # ---- Followers / Following (cursor) ----
    async def list_followers(
        self,
        *,
        user_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[FollowEdge]:
        stmt = (
            select(
                Follow.follower_id,
                Profile.display_name,
                Profile.avatar_url,
                Follow.created_at,
            )
            .join(Profile, Profile.user_id == Follow.follower_id, isouter=True)
            .where(Follow.followee_id == user_id)
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Follow.created_at < cursor_ts,
                    and_(
                        Follow.created_at == cursor_ts,
                        Follow.follower_id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Follow.created_at.desc(), Follow.follower_id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return [FollowEdge(*row) for row in res.all()]

    async def list_following(
        self,
        *,
        user_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[FollowEdge]:
        stmt = (
            select(
                Follow.followee_id,
                Profile.display_name,
                Profile.avatar_url,
                Follow.created_at,
            )
            .join(Profile, Profile.user_id == Follow.followee_id, isouter=True)
            .where(Follow.follower_id == user_id)
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Follow.created_at < cursor_ts,
                    and_(
                        Follow.created_at == cursor_ts,
                        Follow.followee_id < cursor_id,
                    ),
                )
            )
        stmt = stmt.order_by(Follow.created_at.desc(), Follow.followee_id.desc())
        stmt = stmt.limit(limit + 1)
        res = await self._s.execute(stmt)
        return [FollowEdge(*row) for row in res.all()]

    async def counts(self, *, user_id: int) -> tuple[int, int]:
        followers_q = select(func.count()).select_from(Follow).where(Follow.followee_id == user_id)
        following_q = select(func.count()).select_from(Follow).where(Follow.follower_id == user_id)
        followers = (await self._s.execute(followers_q)).scalar_one()
        following = (await self._s.execute(following_q)).scalar_one()
        return int(followers), int(following)

    # ---- Block ----
    async def block(self, *, blocker_id: int, blocked_id: int) -> None:
        stmt = mysql_insert(Block).values(
            blocker_id=blocker_id,
            blocked_id=blocked_id,
            created_at=func.now(),
        )
        stmt = stmt.prefix_with("IGNORE")
        await self._s.execute(stmt)

    async def unblock(self, *, blocker_id: int, blocked_id: int) -> bool:
        stmt = delete(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id)
        return await _exec_delete(self._s, stmt) > 0

    async def is_blocked(self, *, blocker_id: int, blocked_id: int) -> bool:
        stmt = select(
            exists().where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id)
        )
        res = await self._s.execute(stmt)
        return bool(res.scalar())

    async def blocked_either_direction(self, a_id: int, b_id: int) -> bool:
        stmt = select(
            exists().where(
                or_(
                    and_(Block.blocker_id == a_id, Block.blocked_id == b_id),
                    and_(Block.blocker_id == b_id, Block.blocked_id == a_id),
                )
            )
        )
        res = await self._s.execute(stmt)
        return bool(res.scalar())

    async def remove_all_follows_between(self, a_id: int, b_id: int) -> int:
        stmt = delete(Follow).where(
            or_(
                and_(Follow.follower_id == a_id, Follow.followee_id == b_id),
                and_(Follow.follower_id == b_id, Follow.followee_id == a_id),
            )
        )
        return await _exec_delete(self._s, stmt)

    # ---- Mute ----
    async def mute(self, *, muter_id: int, muted_id: int) -> None:
        stmt = mysql_insert(Mute).values(
            muter_id=muter_id,
            muted_id=muted_id,
            created_at=func.now(),
        )
        stmt = stmt.prefix_with("IGNORE")
        await self._s.execute(stmt)

    async def unmute(self, *, muter_id: int, muted_id: int) -> bool:
        stmt = delete(Mute).where(Mute.muter_id == muter_id, Mute.muted_id == muted_id)
        return await _exec_delete(self._s, stmt) > 0

    async def is_muted(self, *, muter_id: int, muted_id: int) -> bool:
        stmt = select(exists().where(Mute.muter_id == muter_id, Mute.muted_id == muted_id))
        res = await self._s.execute(stmt)
        return bool(res.scalar())
