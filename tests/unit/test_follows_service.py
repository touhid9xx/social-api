"""Follows service logic with fake repos."""

from __future__ import annotations

import pytest

from social_api.modules.follows.exceptions import (
    CannotFollowSelfError,
    UserBlockedError,
)
from social_api.modules.follows.service import FollowsService

pytestmark = pytest.mark.unit


class _FakeUsersRepo:
    async def get_by_id(self, user_id: int) -> object:
        return object()  # assume exists


class _FakeFollowsRepo:
    def __init__(self) -> None:
        self.follows: set[tuple[int, int]] = set()
        self.blocks: set[tuple[int, int]] = set()

    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return (a, b) in self.blocks or (b, a) in self.blocks

    async def follow(self, *, follower_id: int, followee_id: int) -> None:
        # Real repo uses MySQL INSERT IGNORE — idempotent, no exception
        # on duplicate. `set.add()` naturally matches that behavior.
        self.follows.add((follower_id, followee_id))

    async def unfollow(self, *, follower_id: int, followee_id: int) -> bool:
        if (follower_id, followee_id) in self.follows:
            self.follows.remove((follower_id, followee_id))
            return True
        return False

    async def is_following(self, *, follower_id: int, followee_id: int) -> bool:
        return (follower_id, followee_id) in self.follows


@pytest.mark.asyncio
async def test_cannot_follow_self() -> None:
    svc = FollowsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeFollowsRepo()  # type: ignore[assignment]
    svc._users = _FakeUsersRepo()  # type: ignore[assignment]
    with pytest.raises(CannotFollowSelfError):
        await svc.follow(follower_id=1, followee_id=1)


@pytest.mark.asyncio
async def test_follow_blocked_user_raises() -> None:
    repo = _FakeFollowsRepo()
    repo.blocks.add((2, 1))  # user 2 blocked user 1
    svc = FollowsService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._users = _FakeUsersRepo()  # type: ignore[assignment]
    with pytest.raises(UserBlockedError):
        await svc.follow(follower_id=1, followee_id=2)


@pytest.mark.asyncio
async def test_double_follow_is_idempotent() -> None:
    repo = _FakeFollowsRepo()
    svc = FollowsService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._users = _FakeUsersRepo()  # type: ignore[assignment]

    await svc.follow(follower_id=1, followee_id=2)
    # Second follow — should not raise (INSERT IGNORE is idempotent).
    await svc.follow(follower_id=1, followee_id=2)
    assert repo.follows == {(1, 2)}


@pytest.mark.asyncio
async def test_unfollow_idempotent() -> None:
    repo = _FakeFollowsRepo()
    svc = FollowsService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._users = _FakeUsersRepo()  # type: ignore[assignment]

    # Not following -> no error
    await svc.unfollow(follower_id=1, followee_id=2)
