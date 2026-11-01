"""Auth service — business logic, DTO returns, no HTTP."""

from __future__ import annotations

import hmac
from datetime import UTC, datetime

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.cache.keys import RedisKeys
from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.core.password import hash_password, verify_password
from social_api.core.security import (
    ACCESS,
    REFRESH,
    RESET,
    VERIFY,
    decode_token,
    issue_access_token,
    issue_password_reset_token,
    issue_refresh_token,
    issue_verification_token,
    password_fingerprint,
    revoke_token,
)
from social_api.email import dispatch_email
from social_api.email.templates import render_password_reset, render_verification
from social_api.i18n import t
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.exceptions import (
    EmailAlreadyRegisteredError,
    InactiveUserError,
    InvalidCredentialsError,
    InvalidTokenError,
    TokenRevokedError,
)
from social_api.modules.auth.models import User
from social_api.modules.auth.repository import UserRepository
from social_api.modules.auth.schemas import (
    AuthTokens,
    LoginResponse,
    MessageResponse,
    RegisterResponse,
    UserPublic,
)

logger = get_logger(__name__)


def _to_public(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        role=user.role.value,  # StrEnum .value → Literal["user"|"moderator"|"admin"]
        is_active=user.is_active,
        is_verified=user.is_verified,
        created_at=user.created_at,
    )


def _build_tokens(user: User) -> AuthTokens:
    settings = get_settings()
    access, _access_jti, _ = issue_access_token(user_id=user.id, role=user.role.value)
    refresh, _refresh_jti, _ = issue_refresh_token(user_id=user.id, role=user.role.value)
    return AuthTokens(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.jwt_access_ttl_seconds,
    )


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = UserRepository(session)

    async def register(
        self,
        *,
        email: str,
        password: str,
        locale: str | None = None,
    ) -> RegisterResponse:
        if await self._repo.email_exists(email):
            raise EmailAlreadyRegisteredError()

        pwd_hash = hash_password(password)
        user = await self._repo.create(email=email, password_hash=pwd_hash)

        # Eagerly create profile (so /me never 404s on first call).
        from social_api.modules.users.service import UsersService

        users_svc = UsersService(self._s)
        await users_svc.get_self_profile(user_id=user.id)

        logger.info("user_registered", user_id=user.id, role=user.role.value)

        # Audit inside the same transaction — AuditService.write flushes
        # but does not commit; the router's get_db() commits at request
        # end, so user + profile + audit row are atomic.
        await AuditService(self._s).write(
            actor_id=user.id,
            action="REGISTER",
            entity="user",
            entity_id=user.id,
        )

        await self._send_verification_email(user=user, locale=locale)
        await self._notify_admins_of_new_user(user_id=user.id)

        return RegisterResponse(
            user=_to_public(user),
            message=t("auth.register.success", locale=locale),
        )

    async def login(self, *, email: str, password: str) -> LoginResponse:
        user = await self._repo.get_by_email(email)
        if user is None or not verify_password(password, user.password_hash):
            # Same error for unknown-user and wrong-password (no enumeration).
            raise InvalidCredentialsError()
        if not user.is_active:
            raise InactiveUserError()

        user.last_login_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save(user)

        tokens = _build_tokens(user)
        logger.info("user_logged_in", user_id=user.id)

        await AuditService(self._s).write(
            actor_id=user.id,
            action="LOGIN",
            entity="user",
            entity_id=user.id,
        )

        return LoginResponse(user=_to_public(user), tokens=tokens)

    async def refresh(self, *, refresh_token: str) -> AuthTokens:
        try:
            payload = decode_token(refresh_token, expected_type=REFRESH)
        except jwt.PyJWTError:
            raise InvalidTokenError() from None

        jti = payload["jti"]
        # Rotation: if already used -> revoked.
        client = get_redis()
        if await client.exists(RedisKeys.jwt_blacklist(jti)):
            raise TokenRevokedError()

        try:
            user_id = int(payload["sub"])
        except (KeyError, ValueError):
            raise InvalidTokenError() from None

        user = await self._repo.get_by_id(user_id)
        if user is None or not user.is_active:
            raise InvalidTokenError()

        # Blacklist old refresh (TTL = remaining lifetime).
        await revoke_token(refresh_token, expected_type=REFRESH)

        logger.info("refresh_rotated", user_id=user.id)
        return _build_tokens(user)

    async def logout(
        self,
        *,
        user_id: int,
        access_token: str,
        refresh_token: str | None = None,
    ) -> None:
        await revoke_token(access_token, expected_type=ACCESS)
        if refresh_token:
            await revoke_token(refresh_token, expected_type=REFRESH)

        await AuditService(self._s).write(
            actor_id=user_id,
            action="LOGOUT",
            entity="user",
            entity_id=user_id,
        )
        logger.info("user_logged_out", user_id=user_id)

    # ------------------------------------------------------------------
    # Email verification + password reset (self-contained JWT tokens)
    # ------------------------------------------------------------------
    async def _send_verification_email(self, *, user: User, locale: str | None) -> None:
        """Best-effort: a mail outage must never fail a registration."""
        settings = get_settings()
        token, _jti, _exp = issue_verification_token(user_id=user.id, role=user.role.value)
        content = render_verification(token=token, locale=locale)
        await dispatch_email(to=user.email, subject=content.subject, body=content.body)
        logger.info(
            "verification_email_dispatched",
            user_id=user.id,
            ttl_seconds=settings.email_verify_ttl_seconds,
        )

    async def _notify_admins_of_new_user(self, *, user_id: int) -> None:
        """Alert every active admin that an account is waiting for review.

        Registration is the only trigger, so a mail outage or an empty admin
        list must never fail the signup that fired it — the whole call is
        wrapped, not just the per-row inserts. The row it writes is the only
        thing that tells staff an unverified account exists: a fresh
        registration has no `display_name`, and the directory shows a masked
        email, so the alert is what turns "someone signed up" into an action.

        Imported here rather than at module scope: `notifications.service`
        reaches into the posts/comments/follows repositories, and auth is the
        lowest layer in the import graph.
        """
        try:
            from social_api.modules.notifications.service import NotificationsService

            admin_ids = await self._repo.list_active_admin_ids()
            if not admin_ids:
                return
            await NotificationsService(self._s).notify_admins_new_user(
                new_user_id=user_id, admin_ids=admin_ids
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("admin_new_user_notify_failed", user_id=user_id, error=str(exc))

    async def verify_email(self, *, token: str) -> User:
        """Consume a purpose='verify' token and flip `is_verified`.

        Idempotent: re-verifying an already-verified account succeeds, so
        a user who double-clicks the emailed link is not punished.
        """
        try:
            payload = decode_token(token, expected_type=VERIFY)
        except jwt.PyJWTError:
            raise InvalidTokenError() from None

        try:
            user_id = int(payload["sub"])
        except (KeyError, ValueError):
            raise InvalidTokenError() from None

        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise InvalidTokenError()
        if not user.is_active:
            raise InactiveUserError()

        if user.is_verified:
            return user

        user.is_verified = True
        await self._repo.save(user)

        await AuditService(self._s).write(
            actor_id=user.id,
            action="VERIFY_EMAIL",
            entity="user",
            entity_id=user.id,
        )
        logger.info("email_verified", user_id=user.id)
        return user

    async def forgot_password(self, *, email: str, locale: str | None = None) -> MessageResponse:
        """Email a reset link — without ever revealing whether the account exists.

        Unknown / inactive / soft-deleted addresses take exactly the same
        path and return exactly the same response as a real one.
        """
        settings = get_settings()
        user = await self._repo.get_by_email(email)
        if user is None or not user.is_active:
            logger.info("password_reset_requested_for_unknown_email")
            return MessageResponse(message=t("auth.reset.sent", locale=locale))

        token, _jti, _exp = issue_password_reset_token(
            user_id=user.id,
            role=user.role.value,
            password_hash=user.password_hash,
        )
        content = render_password_reset(token=token, locale=locale)
        await dispatch_email(to=user.email, subject=content.subject, body=content.body)

        await AuditService(self._s).write(
            actor_id=user.id,
            action="PASSWORD_RESET_REQUESTED",
            entity="user",
            entity_id=user.id,
        )
        logger.info(
            "password_reset_email_dispatched",
            user_id=user.id,
            ttl_seconds=settings.email_reset_ttl_seconds,
        )
        return MessageResponse(message=t("auth.reset.sent", locale=locale))

    async def reset_password(
        self,
        *,
        token: str,
        new_password: str,
        locale: str | None = None,
    ) -> MessageResponse:
        """Consume a purpose='reset' token and set the new password.

        The token's `pwh` claim fingerprints the *current* password hash,
        so a token is single-use with zero server-side state: once the
        password changes, every older reset token stops matching.
        """
        try:
            payload = decode_token(token, expected_type=RESET)
        except jwt.PyJWTError:
            raise InvalidTokenError() from None

        try:
            user_id = int(payload["sub"])
        except (KeyError, ValueError):
            raise InvalidTokenError() from None

        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise InvalidTokenError()
        if not user.is_active:
            raise InactiveUserError()

        claim = payload.get("pwh")
        expected = password_fingerprint(user.password_hash)
        if not isinstance(claim, str) or not hmac.compare_digest(claim, expected):
            # Either forged or already used (password changed since issue).
            raise InvalidTokenError()

        user.password_hash = hash_password(new_password)
        await self._repo.save(user)

        await AuditService(self._s).write(
            actor_id=user.id,
            action="PASSWORD_RESET_COMPLETED",
            entity="user",
            entity_id=user.id,
        )
        logger.info("password_reset_completed", user_id=user.id)
        return MessageResponse(message=t("auth.reset.success", locale=locale))

    async def change_password(
        self,
        *,
        user: User,
        current_password: str,
        new_password: str,
        access_token: str,
        locale: str | None = None,
    ) -> MessageResponse:
        """Rotate the password of an already-authenticated caller.

        The bearer token proves *who* is calling; `current_password` proves
        the caller is the account's owner rather than someone who walked up
        to an unlocked device. A wrong value answers the same
        `INVALID_CREDENTIALS` a failed login does — a distinct
        "wrong current password" code would be a free oracle for confirming
        a password guess against a stolen token.

        Nothing here mints a token: the caller is expected to sign in again
        (the route blacklists the token this request arrived on). Other
        sessions are NOT revoked — refresh/access tokens carry no password
        binding, so they stay valid until they expire. The exception is any
        outstanding *reset* link, which embeds `password_fingerprint` and so
        stops matching the moment the hash changes.
        """
        if not verify_password(current_password, user.password_hash):
            raise InvalidCredentialsError()

        user.password_hash = hash_password(new_password)
        await self._repo.save(user)

        await AuditService(self._s).write(
            actor_id=user.id,
            action="PASSWORD_CHANGED",
            entity="user",
            entity_id=user.id,
        )

        # Kill the credential that performed the change: leaving it alive
        # would let a stolen token keep acting after the owner rotated the
        # password it was issued under.
        await revoke_token(access_token, expected_type=ACCESS)

        logger.info("password_changed", user_id=user.id)
        return MessageResponse(message=t("auth.password.changed", locale=locale))
