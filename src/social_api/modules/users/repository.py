"""Users repository: profiles + consent + staff directory."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import NamedTuple

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.auth.models import User, UserRole
from social_api.modules.users.models import (
    ConsentChannel,
    Profile,
    UserConsent,
    Visibility,
)


class AdminUserRow(NamedTuple):
    """One `users` LEFT JOIN `profiles` row for the staff directory.

    Flattened at the repository boundary so the service never needs a
    second query per row (same shape as `FollowEdge`).
    """

    id: int
    role: UserRole
    is_active: bool
    is_verified: bool
    created_at: datetime
    display_name: str | None
    avatar_url: str | None


class ProfileRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_by_user_id(self, user_id: int) -> Profile | None:
        stmt = select(Profile).where(Profile.user_id == user_id, Profile.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create_default(self, user_id: int) -> Profile:
        profile = Profile(user_id=user_id, visibility=Visibility.PUBLIC)
        self._s.add(profile)
        await self._s.flush()
        await self._s.refresh(profile)
        return profile

    async def save(self, profile: Profile) -> None:
        """Flush pending changes and re-read server-generated columns.

        `updated_at` is set by the DB (server_default / ON UPDATE
        CURRENT_TIMESTAMP). After flush() the ORM marks it expired
        because it has not seen the DB-generated value. Accessing
        `profile.updated_at` in the response builder then triggers a
        sync lazy load outside the greenlet:
            MissingGreenlet: greenlet_spawn has not been called
        refresh() pulls the new value inside the async context, so
        downstream access is safe.
        """
        await self._s.flush()
        await self._s.refresh(profile)

    async def get_by_user_id_including_deleted(self, user_id: int) -> Profile | None:
        """Fetch a profile even if it's been soft-deleted.

        Used by GdprService.cancel_deletion() — reversing a pending
        account deletion must restore the profile that soft_delete_me
        previously marked deleted. The regular get_by_user_id() filters
        deleted_at IS NULL and would return None.
        """
        stmt = select(Profile).where(Profile.user_id == user_id)
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()


class ConsentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_active(self, user_id: int) -> list[UserConsent]:
        """Rows where granted=True and revoked_at is NULL, newest first."""
        stmt = (
            select(UserConsent)
            .where(
                UserConsent.user_id == user_id,
                UserConsent.granted.is_(True),
                UserConsent.revoked_at.is_(None),
            )
            .order_by(UserConsent.created_at.desc())
        )
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def get_active(self, user_id: int, channel: ConsentChannel) -> UserConsent | None:
        stmt = select(UserConsent).where(
            and_(
                UserConsent.user_id == user_id,
                UserConsent.channel == channel,
                UserConsent.granted.is_(True),
                UserConsent.revoked_at.is_(None),
            )
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def grant(
        self,
        user_id: int,
        channel: ConsentChannel,
        *,
        ip: str | None,
        user_agent: str | None,
    ) -> UserConsent:
        now = datetime.now(UTC).replace(tzinfo=None)
        row = UserConsent(
            user_id=user_id,
            channel=channel,
            granted=True,
            granted_at=now,
            ip=ip,
            user_agent=(user_agent or "")[:256] or None,
        )
        self._s.add(row)
        await self._s.flush()
        await self._s.refresh(row)
        return row

    async def revoke(self, row: UserConsent) -> None:
        row.revoked_at = datetime.now(UTC).replace(tzinfo=None)
        await self._s.flush()


class UserDirectoryRepository:
    """Read-only staff-directory queries across `users` + `profiles`."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_users(
        self,
        *,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[AdminUserRow]:
        """Newest-first page of non-deleted users, `limit` rows.

        Uses the `(created_at DESC, id DESC)` keyset the cursor encodes,
        with `id` as the tiebreaker so users created in the same second
        can't be skipped or repeated across pages.
        """
        stmt = (
            select(
                User.id,
                User.role,
                User.is_active,
                User.is_verified,
                User.created_at,
                Profile.display_name,
                Profile.avatar_url,
            )
            .join(Profile, Profile.user_id == User.id, isouter=True)
            .where(User.deleted_at.is_(None))
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    User.created_at < cursor_ts,
                    and_(
                        User.created_at == cursor_ts,
                        User.id < cursor_id,
                    ),
                )
            )
        # Over-fetch by one: the service trims back to `limit` and reads the
        # extra row as proof a further page exists. Without the +1 the
        # `len(rows) > limit` test can never fire and `next_cursor` would
        # always be None — the directory would silently stop after page one.
        stmt = stmt.order_by(User.created_at.desc(), User.id.desc()).limit(limit + 1)
        res = await self._s.execute(stmt)
        return [AdminUserRow(*row) for row in res.all()]
