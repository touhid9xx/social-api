"""RBAC dependency behaviour."""

from __future__ import annotations

import pytest

from social_api.deps import CurrentUser, require_roles
from social_api.exceptions import ForbiddenError
from social_api.modules.auth.models import User, UserRole

pytestmark = pytest.mark.unit


def _fake_user(role: UserRole) -> User:
    u = User(
        id=1,
        email="x@example.com",
        email_hash="h",
        password_hash="x",
        role=role,
    )
    u.created_at = None  # type: ignore[assignment]  # not needed for RBAC
    return u


def _current_user(role: UserRole) -> CurrentUser:
    return CurrentUser(user=_fake_user(role), raw_token="t")


@pytest.mark.asyncio
async def test_admin_allowed() -> None:
    dep = require_roles(UserRole.ADMIN)
    out = await dep(_current_user(UserRole.ADMIN))  # type: ignore[misc]
    assert out.user.role == UserRole.ADMIN


@pytest.mark.asyncio
async def test_user_denied_admin_route() -> None:
    dep = require_roles(UserRole.ADMIN)
    with pytest.raises(ForbiddenError):
        await dep(_current_user(UserRole.USER))  # type: ignore[misc]


@pytest.mark.asyncio
async def test_moderator_allowed_when_listed() -> None:
    dep = require_roles(UserRole.MODERATOR, UserRole.ADMIN)
    out = await dep(_current_user(UserRole.MODERATOR))  # type: ignore[misc]
    assert out.user.role == UserRole.MODERATOR
