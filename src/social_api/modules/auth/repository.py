"""User repository — ORM-only, returns domain objects (User)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.security import hash_email
from social_api.modules.auth.models import User, UserRole


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_by_id(self, user_id: int) -> User | None:
        stmt = select(User).where(User.id == user_id, User.deleted_at.is_(None))
        result = await self._s.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        eh = hash_email(email)
        stmt = select(User).where(User.email_hash == eh, User.deleted_at.is_(None))
        result = await self._s.execute(stmt)
        return result.scalar_one_or_none()

    async def email_exists(self, email: str) -> bool:
        eh = hash_email(email)
        stmt = select(User.id).where(User.email_hash == eh).limit(1)
        result = await self._s.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def create(self, *, email: str, password_hash: str) -> User:
        user = User(
            email=email,
            email_hash=hash_email(email),
            password_hash=password_hash,
        )
        self._s.add(user)
        await self._s.flush()
        await self._s.refresh(user)
        return user

    async def save(self, user: User) -> None:
        await self._s.flush()

    async def list_active_admin_ids(self) -> list[int]:
        """Ids of the admins who should hear about a new registration.

        The audience for the staff alert created by `AuthService.register`:
        active, non-deleted admins only. A deactivated admin can't act on the
        alert, and soft-deleted rows still match `role == ADMIN` (soft delete
        only stamps `deleted_at`), so both filters are load-bearing.
        """
        stmt = (
            select(User.id)
            .where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
            .order_by(User.id)
        )
        res = await self._s.execute(stmt)
        return [int(uid) for uid in res.scalars().all()]

    async def get_by_id_including_deleted(self, user_id: int) -> User | None:
        """Fetch a user even if soft-deleted.

        Used ONLY by get_current_user_allow_deleted (deps.py), which
        backs /gdpr/cancel-delete and /gdpr/deletion-status. Reversing
        a pending deletion must load the row that soft_delete_me marked
        deleted; the regular get_by_id filters deleted_at IS NULL and
        would return None. Every other auth path uses get_by_id.
        """
        stmt = select(User).where(User.id == user_id)
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()
