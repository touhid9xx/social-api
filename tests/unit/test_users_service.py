"""Users service logic with fake repository."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from social_api.core.pagination import decode_cursor
from social_api.exceptions import BadRequestError
from social_api.modules.auth.models import UserRole
from social_api.modules.users.exceptions import (
    LastAdminError,
    OptimisticLockError,
    ProfileNotFoundError,
    ProfileVisibilityError,
    SelfActionError,
)
from social_api.modules.users.models import Profile, Visibility
from social_api.modules.users.repository import AdminUserRow
from social_api.modules.users.schemas import AdminUserUpdate, ProfileUpdate
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


# ---- Admin account management ----
#
# Three mutations, one account, two refusals. The refusals are the interesting
# part: both protect against a state the operator cannot walk back (a console
# with no admins left; an account that locked itself out), so each is asserted
# to (a) raise its own code and (b) write nothing at all.


def _admin_user(**overrides: Any) -> SimpleNamespace:
    """A stand-in for the `User` row — only the attributes the guards read."""
    base: dict[str, Any] = {
        "id": 42,
        "role": UserRole.USER,
        "is_active": True,
        "is_verified": True,
        "deleted_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _admin_row(user_id: int = 42, **overrides: Any) -> AdminUserRow:
    base: dict[str, Any] = {
        "id": user_id,
        "role": UserRole.USER,
        "is_active": True,
        "is_verified": True,
        "created_at": datetime(2026, 1, 1, 12, 0, 0),
        "display_name": "Alice",
        "avatar_url": None,
    }
    base.update(overrides)
    return AdminUserRow(**base)


class _AdminUsers:
    def __init__(self, user: SimpleNamespace | None) -> None:
        self.user = user
        self.saves: list[SimpleNamespace] = []

    async def get_by_id(self, user_id: int) -> SimpleNamespace | None:
        if self.user is None or self.user.id != user_id:
            return None
        return self.user

    async def save(self, user: SimpleNamespace) -> None:
        self.saves.append(user)


class _AdminProfiles:
    def __init__(self, profile: Profile | None) -> None:
        self.profile = profile
        self.saves: list[Profile] = []

    async def get_by_user_id(self, user_id: int) -> Profile | None:
        return self.profile

    async def save(self, profile: Profile) -> None:
        self.saves.append(profile)


class _AdminDirectory:
    """Fake directory that also models the `deleted_at IS NULL` filter.

    That filter is not incidental: it is why `get_user_row` must be called
    *before* a soft delete. If the service re-read afterwards, this fake
    returns None and the delete 404s on its own success path.
    """

    def __init__(
        self,
        rows: dict[int, AdminUserRow],
        other_admins: int,
        user: SimpleNamespace | None = None,
    ) -> None:
        self.rows = rows
        self.other_admins = other_admins
        self.user = user
        self.count_calls: list[int] = []

    async def get_user_row(self, user_id: int) -> AdminUserRow | None:
        if self.user is not None and self.user.deleted_at is not None:
            return None
        return self.rows.get(user_id)

    async def count_active_admins(self, *, excluding: int) -> int:
        self.count_calls.append(excluding)
        return self.other_admins


def _admin_service(
    *,
    user: SimpleNamespace | None = None,
    row: AdminUserRow | None = None,
    other_admins: int = 1,
    profile: Profile | None = None,
) -> tuple[UsersService, _AdminUsers, _AdminDirectory, _AdminProfiles, list[dict[str, Any]]]:
    svc = UsersService(session=None)  # type: ignore[arg-type]
    users = _AdminUsers(user)
    directory = _AdminDirectory({row.id: row} if row is not None else {}, other_admins, user)
    profiles = _AdminProfiles(profile)
    audit: list[dict[str, Any]] = []

    async def _record(**kwargs: Any) -> None:
        audit.append(kwargs)

    svc._users = users  # type: ignore[assignment]
    svc._directory = directory  # type: ignore[assignment]
    svc._profiles = profiles  # type: ignore[assignment]
    svc._audit = _record  # type: ignore[method-assign]
    return svc, users, directory, profiles, audit


@pytest.mark.asyncio
async def test_admin_update_refuses_your_own_account() -> None:
    svc, users, directory, _, audit = _admin_service(user=_admin_user(id=7), row=_admin_row(7))

    with pytest.raises(SelfActionError) as excinfo:
        await svc.admin_update_user(actor_id=7, user_id=7, payload=AdminUserUpdate(is_active=False))

    assert excinfo.value.code == "CANNOT_MODIFY_SELF"
    assert excinfo.value.status_code == 403
    # Refused before anything was touched: no write, no admin count, no audit.
    assert users.saves == []
    assert directory.count_calls == []
    assert audit == []


@pytest.mark.asyncio
async def test_admin_update_refuses_an_empty_body() -> None:
    svc, users, _, _, audit = _admin_service()

    with pytest.raises(BadRequestError) as excinfo:
        await svc.admin_update_user(actor_id=1, user_id=42, payload=AdminUserUpdate())

    # A 200 here would hide a client bug: nothing was asked for, nothing changed.
    assert excinfo.value.detail["code"] == "EMPTY_UPDATE"
    assert users.saves == []
    assert audit == []


@pytest.mark.asyncio
async def test_admin_update_sends_only_the_keys_it_was_given() -> None:
    user = _admin_user(role=UserRole.MODERATOR, is_verified=True)
    svc, _, _, _, audit = _admin_service(user=user, row=_admin_row(role=UserRole.MODERATOR))

    await svc.admin_update_user(actor_id=1, user_id=42, payload=AdminUserUpdate(is_active=False))

    assert user.is_active is False
    # `exclude_unset` is the safeguard: a deactivate must never rewrite a role.
    assert user.role == UserRole.MODERATOR
    assert user.is_verified is True
    assert audit == [
        {
            "actor_id": 1,
            "action": "ADMIN_USER_UPDATE",
            "entity_id": 42,
            "after": {"is_active": False},
        }
    ]


@pytest.mark.asyncio
async def test_admin_update_refuses_to_demote_the_last_admin() -> None:
    user = _admin_user(role=UserRole.ADMIN)
    svc, users, directory, _, audit = _admin_service(
        user=user, row=_admin_row(role=UserRole.ADMIN), other_admins=0
    )

    with pytest.raises(LastAdminError) as excinfo:
        await svc.admin_update_user(actor_id=1, user_id=42, payload=AdminUserUpdate(role="user"))

    assert excinfo.value.code == "LAST_ADMIN_PROTECTED"
    assert excinfo.value.status_code == 409
    assert user.role == UserRole.ADMIN
    assert users.saves == []
    assert audit == []
    # Counted "excluding this account", i.e. how many admins survive the change.
    assert directory.count_calls == [42]


@pytest.mark.asyncio
async def test_admin_update_allows_demotion_once_another_admin_remains() -> None:
    user = _admin_user(role=UserRole.ADMIN)
    svc, _, _directory, _, audit = _admin_service(
        user=user, row=_admin_row(role=UserRole.ADMIN), other_admins=1
    )

    await svc.admin_update_user(actor_id=1, user_id=42, payload=AdminUserUpdate(role="user"))

    assert user.role == UserRole.USER
    assert audit[0]["after"] == {"role": "user"}


@pytest.mark.asyncio
async def test_deactivating_a_plain_user_never_counts_admins() -> None:
    user = _admin_user(role=UserRole.USER)
    svc, _, directory, _, _ = _admin_service(user=user, row=_admin_row())

    await svc.admin_update_user(actor_id=1, user_id=42, payload=AdminUserUpdate(is_active=False))

    # Only an admin can be the last admin; anything else would be a wasted query
    # on the hottest write path.
    assert directory.count_calls == []


@pytest.mark.asyncio
async def test_activate_clears_both_flags_that_block_sign_in() -> None:
    user = _admin_user(is_active=False, is_verified=False)
    svc, users, _, _, audit = _admin_service(user=user, row=_admin_row())

    await svc.admin_activate_user(actor_id=1, user_id=42)

    # Deactivation blocks login; verification is the emailed link the operator
    # cannot click. One action has to clear both or the account stays stuck.
    assert user.is_active is True
    assert user.is_verified is True
    assert users.saves == [user]
    assert audit == [
        {
            "actor_id": 1,
            "action": "USER_ACTIVATED",
            "entity_id": 42,
            "after": {"is_active": True, "is_verified": True},
        }
    ]


@pytest.mark.asyncio
async def test_activate_is_idempotent_and_writes_no_second_audit_row() -> None:
    user = _admin_user(is_active=True, is_verified=True)
    svc, _, _, _, audit = _admin_service(user=user, row=_admin_row())

    await svc.admin_activate_user(actor_id=1, user_id=42)

    # A double-click (or a retry after a dropped response) must not spam the
    # trail with duplicate "activated" entries.
    assert audit == []


@pytest.mark.asyncio
async def test_activate_refuses_your_own_account() -> None:
    svc, users, _, _, _ = _admin_service(user=_admin_user(id=7), row=_admin_row(7))

    with pytest.raises(SelfActionError):
        await svc.admin_activate_user(actor_id=7, user_id=7)

    assert users.saves == []


@pytest.mark.asyncio
async def test_admin_delete_is_soft_and_returns_the_deleted_row() -> None:
    user = _admin_user()
    profile = _fake_profile(user_id=42)
    svc, users, _, profiles, audit = _admin_service(user=user, row=_admin_row(), profile=profile)

    out = await svc.admin_delete_user(actor_id=1, user_id=42)

    assert user.deleted_at is not None
    assert user.is_active is False
    assert profile.deleted_at is not None
    assert users.saves == [user]
    assert profiles.saves == [profile]

    # Regression: the row must be captured BEFORE the delete. The fake directory
    # hides soft-deleted accounts, so a re-read order here fails loudly.
    assert out.id == 42
    assert out.is_active is False

    assert audit[0]["action"] == "ADMIN_USER_DELETE"
    # Same 30-day GDPR window as DELETE /users/me, so the erase is still owned
    # by one place rather than two.
    assert audit[0]["after"]["days_window"] == 30


@pytest.mark.asyncio
async def test_admin_delete_refuses_the_last_admin() -> None:
    user = _admin_user(role=UserRole.ADMIN)
    svc, users, directory, _, audit = _admin_service(
        user=user, row=_admin_row(role=UserRole.ADMIN), other_admins=0
    )

    with pytest.raises(LastAdminError):
        await svc.admin_delete_user(actor_id=1, user_id=42)

    assert user.deleted_at is None
    assert users.saves == []
    assert audit == []
    assert directory.count_calls == [42]


@pytest.mark.asyncio
async def test_admin_mutations_are_404_for_an_unknown_account() -> None:
    svc, users, _, _, _ = _admin_service()

    for call in (
        svc.admin_activate_user,
        svc.admin_delete_user,
    ):
        with pytest.raises(ProfileNotFoundError):
            await call(actor_id=1, user_id=999)

    with pytest.raises(ProfileNotFoundError):
        await svc.admin_update_user(
            actor_id=1, user_id=999, payload=AdminUserUpdate(is_active=False)
        )

    assert users.saves == []
