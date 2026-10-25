"""Follows service."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.logging_config import get_logger
from social_api.modules.auth.repository import UserRepository
from social_api.modules.follows.exceptions import (
    CannotFollowSelfError,
    FollowTargetNotFoundError,
    UserBlockedError,
)
from social_api.modules.follows.repository import FollowEdge, FollowsRepository
from social_api.modules.follows.schemas import (
    FollowCounts,
    FollowListPage,
    FollowStatus,
    FollowUserView,
)

logger = get_logger(__name__)


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    """Parse cursor payload 'ISO8601|user_id' into (timestamp, user_id)."""
    try:
        vals = decode_cursor(cursor)
        return datetime.fromisoformat(vals[0]), int(vals[1])
    except (PaginationError, ValueError, IndexError):
        raise PaginationError("Invalid cursor") from None


def _build_page(rows: list[FollowEdge], limit: int) -> FollowListPage:
    """Trim to `limit`, build next_cursor if more rows exist."""
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor([last.followed_at, last.user_id])

    return FollowListPage(
        items=[
            FollowUserView(
                user_id=r.user_id,
                display_name=r.display_name,
                avatar_url=r.avatar_url,
                followed_at=r.followed_at,
            )
            for r in rows
        ],
        next_cursor=next_cursor,
    )


class FollowsService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = FollowsRepository(session)
        self._users = UserRepository(session)

    async def _ensure_target(self, user_id: int) -> None:
        target = await self._users.get_by_id(user_id)
        if target is None:
            raise FollowTargetNotFoundError()

    async def _invalidate_feed_best_effort(self, *, follower_id: int, reason: str) -> None:
        """Best-effort cache invalidation — never fails the caller."""
        try:
            from social_api.modules.feed.service import FeedService

            await FeedService(self._s).invalidate_for_follow_change(follower_id=follower_id)
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "feed_invalidate_failed",
                follower_id=follower_id,
                error=type(exc).__name__,
            )

    async def follow(self, *, follower_id: int, followee_id: int) -> None:
        if follower_id == followee_id:
            raise CannotFollowSelfError()

        await self._ensure_target(followee_id)

        if await self._repo.blocked_either_direction(follower_id, followee_id):
            raise UserBlockedError()

        await self._repo.follow(follower_id=follower_id, followee_id=followee_id)
        logger.info("user_followed", follower_id=follower_id, followee_id=followee_id)

        await self._invalidate_feed_best_effort(follower_id=follower_id, reason="follow")

    async def unfollow(self, *, follower_id: int, followee_id: int) -> None:
        removed = await self._repo.unfollow(follower_id=follower_id, followee_id=followee_id)
        if removed:
            logger.info(
                "user_unfollowed",
                follower_id=follower_id,
                followee_id=followee_id,
            )
            await self._invalidate_feed_best_effort(follower_id=follower_id, reason="unfollow")

    async def list_followers(
        self, *, user_id: int, cursor: str | None, limit: int | None
    ) -> FollowListPage:
        await self._ensure_target(user_id)
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            cts, cid = _decode_cursor(cursor)

        rows = await self._repo.list_followers(
            user_id=user_id,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )
        return _build_page(rows, lmt)

    async def list_following(
        self, *, user_id: int, cursor: str | None, limit: int | None
    ) -> FollowListPage:
        await self._ensure_target(user_id)
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            cts, cid = _decode_cursor(cursor)

        rows = await self._repo.list_following(
            user_id=user_id,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )
        return _build_page(rows, lmt)

    async def status(self, *, viewer_id: int, target_id: int) -> FollowStatus:
        is_following = await self._repo.is_following(follower_id=viewer_id, followee_id=target_id)
        is_followed_by = await self._repo.is_following(follower_id=target_id, followee_id=viewer_id)
        is_blocked_by_me = await self._repo.is_blocked(blocker_id=viewer_id, blocked_id=target_id)
        has_blocked_me = await self._repo.is_blocked(blocker_id=target_id, blocked_id=viewer_id)
        is_muted = await self._repo.is_muted(muter_id=viewer_id, muted_id=target_id)
        return FollowStatus(
            is_following=is_following,
            is_followed_by=is_followed_by,
            is_blocked_by_me=is_blocked_by_me,
            has_blocked_me=has_blocked_me,
            is_muted_by_me=is_muted,
        )

    async def counts(self, *, user_id: int) -> FollowCounts:
        followers, following = await self._repo.counts(user_id=user_id)
        return FollowCounts(followers=followers, following=following)

    # ---- Block ----
    async def block(self, *, blocker_id: int, blocked_id: int) -> None:
        if blocker_id == blocked_id:
            raise CannotFollowSelfError()
        await self._ensure_target(blocked_id)

        removed = await self._repo.remove_all_follows_between(blocker_id, blocked_id)
        await self._repo.block(blocker_id=blocker_id, blocked_id=blocked_id)
        logger.info(
            "user_blocked",
            blocker_id=blocker_id,
            blocked_id=blocked_id,
            follows_removed=removed,
        )

        # Best-effort cache invalidation for both parties
        try:
            from social_api.modules.feed.service import FeedService

            fs = FeedService(self._s)
            await fs.invalidate_for_block(a_id=blocker_id, b_id=blocked_id)
        except Exception:
            logger.warning(
                "feed_invalidate_failed",
                blocker_id=blocker_id,
                blocked_id=blocked_id,
                reason="block",
            )

    async def unblock(self, *, blocker_id: int, blocked_id: int) -> None:
        await self._repo.unblock(blocker_id=blocker_id, blocked_id=blocked_id)
        logger.info("user_unblocked", blocker_id=blocker_id, blocked_id=blocked_id)

    # ---- Mute ----
    async def mute(self, *, muter_id: int, muted_id: int) -> None:
        if muter_id == muted_id:
            raise CannotFollowSelfError()
        await self._ensure_target(muted_id)
        await self._repo.mute(muter_id=muter_id, muted_id=muted_id)
        logger.info("user_muted", muter_id=muter_id, muted_id=muted_id)

    async def unmute(self, *, muter_id: int, muted_id: int) -> None:
        await self._repo.unmute(muter_id=muter_id, muted_id=muted_id)
        logger.info("user_unmuted", muter_id=muter_id, muted_id=muted_id)

    async def is_following(self, *, follower_id: int, followee_id: int) -> bool:
        return await self._repo.is_following(follower_id=follower_id, followee_id=followee_id)
