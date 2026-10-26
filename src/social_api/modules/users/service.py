"""Users service - profiles, consent, soft-delete, visibility enforcement."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.logging_config import get_logger
from social_api.modules.auth.models import User
from social_api.modules.auth.repository import UserRepository
from social_api.modules.follows.repository import FollowsRepository
from social_api.modules.users.exceptions import (
    OptimisticLockError,
    ProfileNotFoundError,
    ProfileVisibilityError,
)
from social_api.modules.users.models import (
    ConsentChannel,
    Profile,
    Visibility,
)
from social_api.modules.users.repository import (
    ConsentRepository,
    ProfileRepository,
)
from social_api.modules.users.schemas import (
    ConsentRecord,
    DeleteMeResponse,
    ProfilePublic,
    ProfileSelf,
    ProfileUpdate,
)

logger = get_logger(__name__)

_SOFT_DELETE_HARD_DELETE_DAYS = 30


def _to_public(profile: Profile) -> ProfilePublic:
    return ProfilePublic(
        user_id=profile.user_id,
        display_name=profile.display_name,
        bio=profile.bio,
        avatar_url=profile.avatar_url,
        location=profile.location,
        website=profile.website,
        visibility=profile.visibility.value,
    )


def _to_self(profile: Profile) -> ProfileSelf:
    return ProfileSelf(
        user_id=profile.user_id,
        display_name=profile.display_name,
        bio=profile.bio,
        avatar_url=profile.avatar_url,
        location=profile.location,
        website=profile.website,
        visibility=profile.visibility.value,
        pii_visibility=profile.pii_visibility.value,
        dob=profile.dob,
        phone=profile.phone,
        address=profile.address,
        version=profile.version,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


class UsersService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._profiles = ProfileRepository(session)
        self._consents = ConsentRepository(session)
        self._users = UserRepository(session)
        self._follows = FollowsRepository(session)

    async def _ensure_profile(self, user_id: int) -> Profile:
        p = await self._profiles.get_by_user_id(user_id)
        if p is None:
            p = await self._profiles.create_default(user_id)
        return p

    # ---- Read (self) ----
    async def get_self_profile(self, *, user_id: int) -> ProfileSelf:
        """Return the caller's own profile (ensures a default row exists)."""
        profile = await self._ensure_profile(user_id)
        return _to_self(profile)

    # ---- Read (public) ----
    async def get_public_profile(
        self, *, target_user_id: int, viewer_id: int | None
    ) -> ProfilePublic:
        profile = await self._profiles.get_by_user_id(target_user_id)
        if profile is None:
            raise ProfileNotFoundError()

        if viewer_id == target_user_id:
            return _to_public(profile)

        if profile.visibility == Visibility.PRIVATE:
            raise ProfileVisibilityError()

        if profile.visibility == Visibility.FOLLOWERS:
            if viewer_id is None:
                raise ProfileVisibilityError()
            # Real follows-graph check (was TODO(M6) — resolved in M12 polish).
            if not await self._follows.is_following(
                follower_id=viewer_id, followee_id=target_user_id
            ):
                raise ProfileVisibilityError()

        return _to_public(profile)

    # ---- Update ----
    async def update_profile(
        self,
        *,
        user_id: int,
        payload: ProfileUpdate,
    ) -> ProfileSelf:
        profile = await self._ensure_profile(user_id)

        if profile.version != payload.version:
            # 409 with current state so the client can rebase.
            # mode="json" produces ISO strings / JSON-safe scalars — the
            # error handler builds a JSONResponse with plain json.dumps()
            # and cannot serialize datetime.
            raise OptimisticLockError(
                detail={
                    "current_version": profile.version,
                    "current": _to_self(profile).model_dump(mode="json"),
                }
            )

        # Apply only the fields that are explicitly set.
        data = payload.model_dump(exclude_unset=True, exclude={"version"})
        for key, value in data.items():
            if key in {"visibility", "pii_visibility"} and value is not None:
                setattr(profile, key, Visibility(value))
            elif key in {"avatar_url", "website"} and value is not None:
                setattr(profile, key, str(value))
            else:
                setattr(profile, key, value)

        # Optimistic locking: SQLAlchemy will bump `version` on flush
        profile.version += 1
        await self._profiles.save(profile)

        logger.info("profile_updated", user_id=user_id, fields=list(data.keys()))
        return _to_self(profile)

    # ---- Consent ----
    async def grant_consent(
        self,
        *,
        user_id: int,
        channel: str,
        ip: str | None,
        user_agent: str | None,
    ) -> ConsentRecord:
        ch = ConsentChannel(channel)
        row = await self._consents.grant(user_id, ch, ip=ip, user_agent=user_agent)
        logger.info("consent_granted", user_id=user_id, channel=ch.value)
        return ConsentRecord(
            channel=ch.value,
            granted=row.granted,
            granted_at=row.granted_at,
            revoked_at=row.revoked_at,
        )

    async def revoke_consent(self, *, user_id: int, channel: str) -> None:
        ch = ConsentChannel(channel)
        active = await self._consents.get_active(user_id, ch)
        if active is None:
            # Idempotent — revoking an already-revoked channel is a no-op.
            return
        await self._consents.revoke(active)
        logger.info("consent_revoked", user_id=user_id, channel=ch.value)

    async def list_consents(self, *, user_id: int) -> list[ConsentRecord]:
        rows = await self._consents.list_active(user_id)
        return [
            ConsentRecord(
                channel=row.channel.value,
                granted=row.granted,
                granted_at=row.granted_at,
                revoked_at=row.revoked_at,
            )
            for row in rows
        ]

    # ---- Delete ----
    async def soft_delete_me(self, *, user_id: int) -> DeleteMeResponse:
        user: User | None = await self._users.get_by_id(user_id)
        if user is None:
            raise ProfileNotFoundError()

        now = datetime.now(UTC).replace(tzinfo=None)
        user.deleted_at = now
        user.is_active = False
        await self._users.save(user)

        # Also soft-delete the profile row
        profile = await self._profiles.get_by_user_id(user_id)
        if profile is not None:
            profile.deleted_at = now
            await self._profiles.save(profile)

        hard_delete_at = datetime.now(UTC) + timedelta(days=_SOFT_DELETE_HARD_DELETE_DAYS)

        logger.info("user_soft_deleted", user_id=user_id)
        return DeleteMeResponse(
            message=(
                "Account scheduled for deletion. It will be permanently "
                f"removed after {_SOFT_DELETE_HARD_DELETE_DAYS} days."
            ),
            hard_delete_after=hard_delete_at,
        )
