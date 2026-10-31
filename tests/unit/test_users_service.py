"""Users service logic with fake repository."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.core.pagination import decode_cursor
from social_api.exceptions import BadRequestError
from social_api.modules.auth.models import UserRole
from social_api.modules.users.exceptions import (
    OptimisticLockError,
    ProfileVisibilityError,
)
from social_api.modules.users.models import Profile, Visibility
from social_api.modules.users.repository import AdminUserRow
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


# ---- Admin directory ----


def _row(user_id: int, created_at: datetime) -> AdminUserRow:
    return AdminUserRow(
        id=user_id,
        role=UserRole.USER,
        is_active=True,
        is_verified=True,
        created_at=created_at,
        display_name=f"User {user_id}",
        avatar_url=None,
    )


class _Directory:
    """Fake directory repo mirroring the real over-fetch (limit + 1).

    The `+ 1` is the whole point: it is the repository's job, and the
    service reads the surplus row as proof a further page exists.
    """

    def __init__(self, rows: list[AdminUserRow]) -> None:
        self.rows = rows
        self.calls: list[dict[str, Any]] = []

    async def list_users(
        self,
        *,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[AdminUserRow]:
        self.calls.append({"cursor_ts": cursor_ts, "cursor_id": cursor_id, "limit": limit})
        return self.rows[: limit + 1]


def _service(rows: list[AdminUserRow]) -> tuple[UsersService, _Directory]:
    directory = _Directory(rows)
    svc = UsersService(session=None)  # type: ignore[arg-type]
    svc._directory = directory  # type: ignore[assignment]
    return svc, directory


@pytest.mark.asyncio
async def test_list_users_emits_cursor_when_more_rows_exist() -> None:
    # Newest-first, as the repository orders them. Timestamps are naive
    # because the DB columns are (DateTime(timezone=False)).
    rows = [
        _row(3, datetime(2026, 3, 1, 12, 0, 0)),
        _row(2, datetime(2026, 3, 1, 11, 0, 0)),
        _row(1, datetime(2026, 3, 1, 10, 0, 0)),
    ]
    svc, directory = _service(rows)

    page = await svc.list_users(cursor=None, limit=2)

    assert [item.id for item in page.items] == [3, 2]
    assert page.items[0].role == "user"
    assert page.items[0].display_name == "User 3"
    assert page.next_cursor is not None
    # The service hands the *clamped* limit down; the +1 lives in the repo.
    assert directory.calls == [{"cursor_ts": None, "cursor_id": None, "limit": 2}]

    # The cursor points at the last returned row, so the next page resumes
    # strictly after it rather than repeating it.
    assert decode_cursor(page.next_cursor) == [
        rows[1].created_at.replace(tzinfo=UTC).isoformat(),
        rows[1].id,
    ]


@pytest.mark.asyncio
async def test_list_users_no_cursor_when_page_exactly_fits() -> None:
    rows = [
        _row(3, datetime(2026, 3, 1, 12, 0, 0)),
        _row(2, datetime(2026, 3, 1, 11, 0, 0)),
    ]
    svc, _ = _service(rows)

    page = await svc.list_users(cursor=None, limit=2)

    assert [item.id for item in page.items] == [3, 2]
    assert page.next_cursor is None


@pytest.mark.asyncio
async def test_list_users_forwards_cursor_to_repository() -> None:
    rows = [
        _row(5, datetime(2026, 3, 2, 9, 0, 0)),
        _row(4, datetime(2026, 3, 2, 8, 0, 0)),
        _row(3, datetime(2026, 3, 2, 7, 0, 0)),
    ]
    svc, directory = _service(rows)

    first = await svc.list_users(cursor=None, limit=2)
    assert first.next_cursor is not None

    await svc.list_users(cursor=first.next_cursor, limit=2)

    # Naive in the DB, UTC-aware once it has been through the cursor.
    assert directory.calls[1]["cursor_ts"] == rows[1].created_at.replace(tzinfo=UTC)
    assert directory.calls[1]["cursor_id"] == rows[1].id


@pytest.mark.asyncio
async def test_list_users_rejects_malformed_cursor() -> None:
    svc, directory = _service([])

    with pytest.raises(BadRequestError) as excinfo:
        await svc.list_users(cursor="not-a-real-cursor", limit=20)

    # 400, not a 500 — and the same code the other cursor endpoints emit so
    # the frontend's INVALID_CURSOR mapping applies unchanged.
    assert excinfo.value.detail["code"] == "INVALID_CURSOR"
    assert directory.calls == []


@pytest.mark.asyncio
async def test_list_users_clamps_limit() -> None:
    svc, directory = _service([])

    await svc.list_users(cursor=None, limit=None)
    await svc.list_users(cursor=None, limit=500)

    assert [call["limit"] for call in directory.calls] == [20, 100]
