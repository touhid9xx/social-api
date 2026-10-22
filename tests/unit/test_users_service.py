"""Users service logic with fake repository."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.users.exceptions import (
    OptimisticLockError,
    ProfileVisibilityError,
)
from social_api.modules.users.models import Profile, Visibility
from social_api.modules.users.schemas import ProfileUpdate
from social_api.modules.users.service import UsersService

pytestmark = pytest.mark.unit


def _fake_profile(**overrides: Any) -> Profile:
    base: dict[str, Any] = {
        "id": 1,
        "user_id": 42,
        "display_name": "Alice",
        "bio": "hi",
        "avatar_url": None,
        "location": None,
        "website": None,
        "dob": None,
        "phone": None,
        "address": None,
        "visibility": Visibility.PUBLIC,
        "pii_visibility": Visibility.PRIVATE,
        "version": 1,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
        "deleted_at": None,
    }
    base.update(overrides)
    return Profile(**base)


@pytest.mark.asyncio
async def test_private_profile_denied_to_others() -> None:
    profile = _fake_profile(visibility=Visibility.PRIVATE)

    class _Repo:
        async def get_by_user_id(self, user_id: int) -> Profile:
            return profile

    svc = UsersService(session=None)  # type: ignore[arg-type]
    svc._profiles = _Repo()  # type: ignore[assignment]

    with pytest.raises(ProfileVisibilityError):
        await svc.get_public_profile(target_user_id=42, viewer_id=999)


@pytest.mark.asyncio
async def test_private_profile_allowed_to_owner() -> None:
    profile = _fake_profile(visibility=Visibility.PRIVATE)

    class _Repo:
        async def get_by_user_id(self, user_id: int) -> Profile:
            return profile

    svc = UsersService(session=None)  # type: ignore[arg-type]
    svc._profiles = _Repo()  # type: ignore[assignment]

    out = await svc.get_public_profile(target_user_id=42, viewer_id=42)
    assert out.user_id == 42
    assert out.display_name == "Alice"


@pytest.mark.asyncio
async def test_optimistic_lock_conflict() -> None:
    profile = _fake_profile(version=5)

    class _Repo:
        async def get_by_user_id(self, user_id: int) -> Profile:
            return profile

        async def create_default(self, user_id: int) -> Profile:
            return profile

        async def save(self, p: Profile) -> None:
            pass

    svc = UsersService(session=None)  # type: ignore[arg-type]
    svc._profiles = _Repo()  # type: ignore[assignment]

    with pytest.raises(OptimisticLockError) as excinfo:
        await svc.update_profile(
            user_id=42,
            payload=ProfileUpdate(version=1, display_name="Bob"),
        )
    err = excinfo.value
    # err.detail is dict[str, Any] (from AppError) — no ignore needed
    assert err.detail["current_version"] == 5
    assert err.detail["current"]["user_id"] == 42


@pytest.mark.asyncio
async def test_update_bumps_version_on_success() -> None:
    profile = _fake_profile(version=3)

    class _Repo:
        async def get_by_user_id(self, user_id: int) -> Profile:
            return profile

        async def create_default(self, user_id: int) -> Profile:
            return profile

        async def save(self, p: Profile) -> None:
            pass

    svc = UsersService(session=None)  # type: ignore[arg-type]
    svc._profiles = _Repo()  # type: ignore[assignment]

    out = await svc.update_profile(
        user_id=42,
        payload=ProfileUpdate(version=3, display_name="Bob"),
    )
    assert out.display_name == "Bob"
    assert profile.version == 4
