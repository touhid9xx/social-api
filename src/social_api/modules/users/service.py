"""Users service - profiles, consent, soft-delete, visibility enforcement."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
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
    AdminUserRow,
    ConsentRepository,
    ProfileRepository,
    UserDirectoryRepository,
)
from social_api.modules.users.schemas import (
    AdminUserPage,
    AdminUserView,
    ConsentRecord,
    DeleteMeResponse,
    ProfilePublic,
    ProfileSelf,
    ProfileUpdate,
)

logger = get_logger(__name__)

_SOFT_DELETE_HARD_DELETE_DAYS = 30


def _decode_user_cursor(cursor: str) -> tuple[datetime, int]:
    """Parse cursor payload '[ISO8601, user_id]' into (created_at, id).

    A malformed or tampered cursor is a client mistake, not a server fault,
    so it becomes a 400 with the same `INVALID_CURSOR` code every other
    cursor endpoint (likes, audit, follows) emits. `PaginationError` is a
    bare `ValueError` subclass with no registered handler — letting it
    escape would reach `unhandled_exception_handler` and surface as a 500.
    """
    try:
        vals = decode_cursor(cursor)
        return datetime.fromisoformat(vals[0]), int(vals[1])
    except (PaginationError, ValueError, IndexError):
        raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None


def _build_user_page(rows: list[AdminUserRow], limit: int) -> AdminUserPage:
    """Trim to `limit`, emit next_cursor when the repository over-fetched."""
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor([last.created_at, last.id])

    return AdminUserPage(
        items=[
            AdminUserView(
                id=r.id,
                role=r.role.value,
                is_active=r.is_active,
                is_verified=r.is_verified,
                created_at=r.created_at,
                display_name=r.display_name,
                avatar_url=r.avatar_url,
            )
            for r in rows
        ],
        next_cursor=next_cursor,
    )


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
        self._s = session
        self._profiles = ProfileRepository(session)
        self._consents = ConsentRepository(session)
        self._users = UserRepository(session)
        self._follows = FollowsRepository(session)
        self._directory = UserDirectoryRepository(session)

    async def _audit(
        self,
        *,
        actor_id: int,
        action: str,
        entity_id: int,
        entity: str = "user",
        after: dict[str, object] | None = None,
    ) -> None:
        """Best-effort audit write. Never fails the caller.

        Audit is a forensic observation — if the write itself fails
        (Redis/DB hiccup, table lock), the business action must still
        complete. Same pattern as FollowsService._audit.

        `entity` names the *kind* of row `entity_id` points at, so the
        admin filter (`/audit?entity=...&entity_id=...`) joins to the right
        table. Profile updates pass `entity="profile"` because they carry a
        `profile_id`, not a `user_id`.
        """
        try:
            await AuditService(self._s).write(
                actor_id=actor_id,
                action=action,
                entity=entity,
                entity_id=entity_id,
                after=after,
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "audit_write_failed",
                action=action,
                entity_id=entity_id,
                error=type(exc).__name__,
            )

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
            # Real follows-graph check.
            if not await self._follows.is_following(
                follower_id=viewer_id, followee_id=target_user_id
            ):
                raise ProfileVisibilityError()

        return _to_public(profile)

    # ---- Read (admin directory) ----
    async def list_users(
        self, *, cursor: str | None, limit: int | None
    ) -> AdminUserPage:
        """Admin-only directory of non-deleted accounts, newest first.

        Same cursor contract as every other list endpoint: clamp the
        client's limit, decode the opaque cursor, let the repository
        over-fetch by one, then trim. `next_cursor` is emitted only when
        a further page genuinely exists, so the client's "end of list"
        state is driven by data rather than by a short page.
        """
        lmt = clamp_limit(limit)

        cursor_ts: datetime | None = None
        cursor_id: int | None = None
        if cursor:
            cursor_ts, cursor_id = _decode_user_cursor(cursor)

        rows = await self._directory.list_users(
            cursor_ts=cursor_ts,
            cursor_id=cursor_id,
            limit=lmt,
        )
        return _build_user_page(rows, lmt)

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

        # Optimistic locking: SQLAlchemy will bump `version` on flush.
        profile.version += 1
        await self._profiles.save(profile)

        # Best-effort audit — field NAMES only (values may be PII).
        await self._audit(
            actor_id=user_id,
            action="PROFILE_UPDATE",
            entity="profile",
            entity_id=profile.id,
            after={"fields_changed": list(data.keys())},
        )

        logger.info(
            "profile_updated",
            user_id=user_id,
            fields=list(data.keys()),
        )
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

        # GDPR: consent grant is a legal record — audit it.
        await self._audit(
            actor_id=user_id,
            action="CONSENT_GRANTED",
            entity_id=user_id,
            after={"channel": ch.value},
        )

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

        await self._audit(
            actor_id=user_id,
            action="CONSENT_REVOKED",
            entity_id=user_id,
            after={"channel": ch.value},
        )

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

        # Also soft-delete the profile row.
        profile = await self._profiles.get_by_user_id(user_id)
        if profile is not None:
            profile.deleted_at = now
            await self._profiles.save(profile)

        hard_delete_at = datetime.now(UTC) + timedelta(days=_SOFT_DELETE_HARD_DELETE_DAYS)

        # GDPR: user-initiated account deletion is the most sensitive
        # user action. M19 retention job will query users.deleted_at <
        # NOW() - 30d and invoke GdprService.hard_delete().
        await self._audit(
            actor_id=user_id,
            action="USER_SOFT_DELETE",
            entity_id=user_id,
            after={
                "hard_delete_after": hard_delete_at.isoformat(),
                "days_window": _SOFT_DELETE_HARD_DELETE_DAYS,
            },
        )

        logger.info(
            "user_soft_deleted",
            user_id=user_id,
            hard_delete_after=hard_delete_at.isoformat(),
        )
        return DeleteMeResponse(
            message=(
                "Account scheduled for deletion. It will be permanently "
                f"removed after {_SOFT_DELETE_HARD_DELETE_DAYS} days."
            ),
            hard_delete_after=hard_delete_at,
        )
