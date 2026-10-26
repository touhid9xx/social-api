"""Auth service — business logic, DTO returns, no HTTP."""

from __future__ import annotations

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
    decode_token,
    issue_access_token,
    issue_refresh_token,
    revoke_token,
)
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

    async def register(self, *, email: str, password: str) -> RegisterResponse:
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

        return RegisterResponse(
            user=_to_public(user),
            message="Registration successful, please verify your email",
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
