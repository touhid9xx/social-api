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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise UnauthorizedError()

    token = credentials.credentials
    try:
        payload = decode_token(token, expected_type=ACCESS)
    except jwt.PyJWTError:
        raise UnauthorizedError("Invalid or expired token") from None

    jti = payload["jti"]
    if await is_blacklisted(jti):
        raise UnauthorizedError("Token revoked")

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise UnauthorizedError() from None

    repo = UserRepository(session)
    user = await repo.get_by_id(user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError("User not found or inactive")

    cu = CurrentUser(user=user, raw_token=token)
    # attach to request for rate-limit key_func when needed
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
