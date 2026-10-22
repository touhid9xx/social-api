"""Users repository: profiles + consent."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.users.models import (
    ConsentChannel,
    Profile,
    UserConsent,
    Visibility,
)


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
        await self._s.flush()


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
