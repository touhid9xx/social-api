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
from social_api.core.security import issue_verification_token
from social_api.email import dispatch_email
from social_api.email.templates import render_verification
from social_api.exceptions import BadRequestError
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.repository import UserRepository
from social_api.modules.follows.repository import FollowsRepository
from social_api.modules.users.exceptions import (
    AlreadyVerifiedError,
    LastAdminError,
    OptimisticLockError,
    ProfileNotFoundError,
    ProfileVisibilityError,
    SelfActionError,
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
    AdminUserUpdate,
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


def _mask_email(email: str) -> str:
    """`t***@example.com` — enough to recognise an account, not to contact it.

    Masking here (rather than in the schema) keeps the raw address inside
    this module: `AdminUserView` only ever sees the masked form, so a future
    change to the view cannot accidentally serialise the ciphertext's
    plaintext. Same intent as `email.sms._masked`, which keeps a trace of a
    phone number without exposing it.
    """
    local, sep, domain = email.partition("@")
    if not sep or not local:
        # Unreachable for rows that passed registration validation; fail
        # closed rather than echoing something unrecognisable.
        return "***"
    return f"{local[0]}***@{domain}"


def _to_admin_view(row: AdminUserRow) -> AdminUserView:
    """One directory row → wire view. Shared by the list and the mutations
    so a PATCH response is byte-identical to the row the list would show."""
    return AdminUserView(
        id=row.id,
        role=row.role.value,
        is_active=row.is_active,
        is_verified=row.is_verified,
        created_at=row.created_at,
        display_name=row.display_name,
        avatar_url=row.avatar_url,
        email_masked=_mask_email(row.email),
    )


def _build_user_page(rows: list[AdminUserRow], limit: int) -> AdminUserPage:
    """Trim to `limit`, emit next_cursor when the repository over-fetched."""
    next_cursor: str | None = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = encode_cursor([last.created_at, last.id])

    return AdminUserPage(
        items=[_to_admin_view(r) for r in rows],
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
    async def list_users(self, *, cursor: str | None, limit: int | None) -> AdminUserPage:
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

    # ---- Admin: account management ----
    #
    # Three mutations over ONE account. All of them share the same shape:
    # load the live row, refuse the two changes that are one-way traps
    # (acting on yourself / removing the last admin), apply, re-read, audit.
    # The re-read is what makes the response trustworthy — the client patches
    # its cache with exactly these bytes instead of guessing.

    async def _guarded_user(self, *, actor_id: int, user_id: int) -> User:
        """Load a live account and refuse the self-action trap.

        Every admin mutation funnels through here so the "you cannot do this
        to yourself" rule cannot be forgotten in one of the three methods.
        """
        if user_id == actor_id:
            raise SelfActionError()
        user: User | None = await self._users.get_by_id(user_id)
        if user is None:
            raise ProfileNotFoundError()
        return user

    async def _refuse_last_admin(self, *, user: User) -> None:
        """Raise when `user` is the only active admin left.

        Called only by paths that are about to take admin power away
        (demote, deactivate, delete). Counting with `excluding=user.id`
        makes the check "how many admins remain afterwards", which is the
        question that actually matters.
        """
        if user.role != UserRole.ADMIN or not user.is_active:
            return
        if await self._directory.count_active_admins(excluding=user.id) == 0:
            raise LastAdminError()

    async def _admin_row(self, user_id: int) -> AdminUserView:
        """Re-read the directory row so the response reflects the write."""
        row = await self._directory.get_user_row(user_id)
        if row is None:  # pragma: no cover — guarded caller just loaded it
            raise ProfileNotFoundError()
        return _to_admin_view(row)

    async def admin_update_user(
        self,
        *,
        actor_id: int,
        user_id: int,
        payload: AdminUserUpdate,
    ) -> AdminUserView:
        """Admin PATCH: change role / active flag / verified flag.

        `exclude_unset` means an omitted key is left untouched, so a request
        that only deactivates an account can never quietly rewrite its role.
        An empty body is a 400 rather than a silent no-op: a mutation that
        changes nothing is a client bug, and answering 200 would hide it.
        """
        # `exclude_none` treats an explicit `null` exactly like an omitted key.
        # Without it, `{"is_active": null}` would reach `setattr` below and try to
        # write NULL into a NOT NULL column — a 500 on a request the client should
        # simply have left out. "No change" is the only safe reading of a null here.
        data = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not data:
            raise BadRequestError("No fields to update", detail={"code": "EMPTY_UPDATE"})

        user = await self._guarded_user(actor_id=actor_id, user_id=user_id)

        losing_admin = user.role == UserRole.ADMIN and (
            data.get("role", user.role.value) != UserRole.ADMIN.value
            or data.get("is_active", user.is_active) is False
        )
        if losing_admin:
            await self._refuse_last_admin(user=user)

        for key, value in data.items():
            if key == "role":
                user.role = UserRole(value)
            else:
                setattr(user, key, value)
        await self._users.save(user)

        await self._audit(
            actor_id=actor_id,
            action="ADMIN_USER_UPDATE",
            entity_id=user_id,
            after=dict(data),
        )
        logger.info(
            "admin_user_updated",
            actor_id=actor_id,
            user_id=user_id,
            fields=sorted(data),
        )
        return await self._admin_row(user_id)

    async def admin_activate_user(self, *, actor_id: int, user_id: int) -> AdminUserView:
        """Admin "activate": clear deactivation and mark the email verified.

        The two flags travel together on purpose. Deactivation is what
        actually blocks login (`AuthService.login` → `InactiveUserError`),
        while `is_verified` is normally flipped by clicking the emailed
        link — which the operator cannot do. An admin vouching for an
        account is the manual equivalent of that click, so this single
        action makes the account usable end to end. Use `admin_update_user`
        when only one of the two should change.

        Idempotent: activating an already-active, already-verified account
        succeeds and returns the unchanged row, so a double-click or a retry
        after a dropped response is harmless.
        """
        user = await self._guarded_user(actor_id=actor_id, user_id=user_id)

        changed = not user.is_active or not user.is_verified
        user.is_active = True
        user.is_verified = True
        await self._users.save(user)

        if changed:
            await self._audit(
                actor_id=actor_id,
                action="USER_ACTIVATED",
                entity_id=user_id,
                after={"is_active": True, "is_verified": True},
            )
        logger.info("admin_user_activated", actor_id=actor_id, user_id=user_id)
        return await self._admin_row(user_id)

    async def admin_verify_user(self, *, actor_id: int, user_id: int) -> AdminUserView:
        """Admin vouches for an account — the manual equivalent of the email click.

        Deliberately narrower than `admin_activate_user`: this flips only
        `is_verified` and leaves `is_active` exactly as it was. The two are
        separate questions ("is this address real?" vs "may this account sign
        in?"), and an operator confirming an address must not silently
        resurrect an account they suspended on purpose.

        Idempotent: verifying an already-verified account returns the
        unchanged row instead of a 409, because the desired end state
        already holds — a retry after a dropped response is not an error.
        """
        user = await self._guarded_user(actor_id=actor_id, user_id=user_id)

        if user.is_verified:
            return await self._admin_row(user_id)

        user.is_verified = True
        await self._users.save(user)

        await self._audit(
            actor_id=actor_id,
            action="ADMIN_USER_VERIFY",
            entity_id=user_id,
            after={"is_verified": True},
        )
        logger.info("admin_user_verified", actor_id=actor_id, user_id=user_id)
        return await self._admin_row(user_id)

    async def admin_resend_verification(
        self, *, actor_id: int, user_id: int, locale: str | None = None
    ) -> AdminUserView:
        """Mail the account a fresh verification link on the operator's behalf.

        Same token/rendering path as registration (`issue_verification_token`
        + `render_verification`), so the link a user receives here is
        indistinguishable from the one they would have got at signup — and
        dies under the same TTL.

        Refuses an already-verified account with 409: mailing a link that can
        only re-set a flag that is already set is an action with no effect,
        and a button that reports success while changing nothing teaches
        operators to distrust it.

        `dispatch_email` never raises (a mail outage must not fail an admin
        action), so the audit row records the *attempt*. It is written after
        dispatch so the trail reflects that the operator's request reached
        the mail layer.
        """
        user = await self._guarded_user(actor_id=actor_id, user_id=user_id)
        if user.is_verified:
            raise AlreadyVerifiedError()

        token, _jti, _exp = issue_verification_token(user_id=user.id, role=user.role.value)
        content = render_verification(token=token, locale=locale)
        await dispatch_email(to=user.email, subject=content.subject, body=content.body)

        await self._audit(
            actor_id=actor_id,
            action="RESEND_VERIFICATION",
            entity_id=user_id,
            after={"dispatched": True},
        )
        logger.info(
            "admin_verification_resent",
            actor_id=actor_id,
            user_id=user_id,
        )
        return await self._admin_row(user_id)

    async def admin_delete_user(self, *, actor_id: int, user_id: int) -> AdminUserView:
        """Admin delete — soft, same shape as `soft_delete_me`.

        `deleted_at` + `is_active=False` on both the account and its profile,
        so the row disappears from every read path while the GDPR retention
        window (30 days) still owns the real erase. Hard-deleting here would
        bypass that window and destroy data the user may still be entitled
        to have restored.

        Returns the final row (now `is_active=False`) so the caller can patch
        its cache in place rather than refetch the page.
        """
        user = await self._guarded_user(actor_id=actor_id, user_id=user_id)
        await self._refuse_last_admin(user=user)

        # Read the row BEFORE deleting: `get_user_row` filters out
        # soft-deleted accounts, so re-reading afterwards would 404 on the
        # success path. The delete only clears `is_active`, so patching that
        # one field onto the pre-delete view is exactly the post-delete row.
        before = await self._admin_row(user_id)

        now = datetime.now(UTC).replace(tzinfo=None)
        user.deleted_at = now
        user.is_active = False
        await self._users.save(user)

        profile = await self._profiles.get_by_user_id(user_id)
        if profile is not None:
            profile.deleted_at = now
            await self._profiles.save(profile)

        await self._audit(
            actor_id=actor_id,
            action="ADMIN_USER_DELETE",
            entity_id=user_id,
            after={
                "hard_delete_after": (
                    datetime.now(UTC) + timedelta(days=_SOFT_DELETE_HARD_DELETE_DAYS)
                ).isoformat(),
                "days_window": _SOFT_DELETE_HARD_DELETE_DAYS,
            },
        )
        logger.info("admin_user_deleted", actor_id=actor_id, user_id=user_id)
        return before.model_copy(update={"is_active": False})
