"""Shared FastAPI dependencies: DB session, current user, RBAC."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.security import ACCESS, decode_token, is_blacklisted
from social_api.db.session import get_db
from social_api.exceptions import ForbiddenError, UnauthorizedError
from social_api.modules.auth.models import User, UserRole
from social_api.modules.auth.repository import UserRepository

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    user: User
    raw_token: str


async def _load_user_from_token(
    token: str,
    session: AsyncSession,
    *,
    allow_deleted: bool,
) -> User:
    """Shared token→user pipeline used by both variants below.

    Steps:
      1. Decode (signature + type + expiry).
      2. Reject blacklisted JTI (logout / rotation).
      3. Load user — including soft-deleted when allow_deleted=True.
      4. Active check (skipped when allow_deleted=True).

    Keeping this inline (instead of calling _load_user_from_token twice
    in the public deps) avoids double decoding in the fast path.
    """
    try:
        payload = decode_token(token, expected_type=ACCESS)
    except jwt.PyJWTError:
        raise UnauthorizedError("Invalid or expired token") from None

    jti = payload.get("jti")
    if not jti or await is_blacklisted(jti):
        raise UnauthorizedError("Token revoked")

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise UnauthorizedError() from None

    repo = UserRepository(session)
    if allow_deleted:
        user = await repo.get_by_id_including_deleted(user_id)
    else:
        user = await repo.get_by_id(user_id)

    if user is None:
        raise UnauthorizedError("User not found or inactive")

    if not allow_deleted and not user.is_active:
        raise UnauthorizedError("User not found or inactive")

    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError()

    token = credentials.credentials
    user = await _load_user_from_token(token, session, allow_deleted=False)

    cu = CurrentUser(user=user, raw_token=token)
    if request is not None:
        request.state.user = user
        import structlog

        structlog.contextvars.bind_contextvars(user_id=user.id)
    return cu


async def get_current_user_allow_deleted(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]
) -> CurrentUser:
    """Like get_current_user, but accepts soft-deleted users.

    Used ONLY by:
      - POST /api/v1/gdpr/cancel-delete
      - GET  /api/v1/gdpr/deletion-status

    A user who scheduled account deletion must be able to cancel it
    during the 30-day grace window. Every other endpoint (including
    /gdpr/export) must still reject soft-deleted users — otherwise
    a deleted account remains a live authenticated identity.
    """
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError()

    token = credentials.credentials
    user = await _load_user_from_token(token, session, allow_deleted=True)

    cu = CurrentUser(user=user, raw_token=token)
    if request is not None:
        request.state.user = user
    return cu


def require_roles(*roles: UserRole) -> Callable[[CurrentUser], CurrentUser]:
    """RBAC guard — usage: Depends(require_roles(UserRole.ADMIN))."""
    allowed = set(roles)

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.user.role not in allowed:
            raise ForbiddenError()
        return user

    return _dep  # type: ignore[return-value]
