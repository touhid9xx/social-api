"""Posts service visibility + optimistic lock."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.auth.models import User, UserRole
from social_api.modules.posts.exceptions import (
    PostForbiddenError,
    PostNotFoundError,
)
from social_api.modules.posts.models import Post
from social_api.modules.posts.service import PostsService
from social_api.modules.users.exceptions import OptimisticLockError
from social_api.modules.users.models import Visibility

pytestmark = pytest.mark.unit


def _post(**overrides: Any) -> Post:
    base: dict[str, Any] = {
        "id": 1,
        "author_id": 42,
        "body": "hello",
        "visibility": Visibility.PUBLIC,
        "media_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "created_at": datetime(2026, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
        "deleted_at": None,
        "version": 1,
    }
    base.update(overrides)
    return Post(**base)


def _user(uid: int, role: UserRole = UserRole.USER) -> User:
    u = User(
        id=uid,
        email="x@example.com",
        email_hash="h",
        password_hash="x",
        role=role,
        is_active=True,
        is_verified=False,
    )
    u.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    return u


class _FakeRepo:
    def __init__(self, post: Post | None) -> None:
        self._p = post

    async def get_by_id(self, post_id: int) -> Post | None:
        return self._p

    async def save(self, post: Post) -> None:
        pass


class _FakeLikes:
    async def exists(self, **kw: Any) -> bool:
        return False

    async def exists_batch(self, **kw: Any) -> set[int]:
        return set()


class _FakeFollows:
    async def is_following(self, **kw: Any) -> bool:
        return False

    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return False


@pytest.mark.asyncio
async def test_private_post_404_to_other_viewer() -> None:
    post = _post(visibility=Visibility.PRIVATE)
    svc = PostsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeRepo(post)  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]
    svc._follows = _FakeFollows()  # type: ignore[assignment]

    with pytest.raises(PostNotFoundError):
        await svc.get(viewer_id=999, post_id=1)


@pytest.mark.asyncio
async def test_private_post_visible_to_author() -> None:
    post = _post(visibility=Visibility.PRIVATE)
    svc = PostsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeRepo(post)  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]
    svc._follows = _FakeFollows()  # type: ignore[assignment]

    out = await svc.get(viewer_id=42, post_id=1)
    assert out.id == 1


@pytest.mark.asyncio
async def test_update_non_author_forbidden() -> None:
    post = _post()
    svc = PostsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeRepo(post)  # type: ignore[assignment]
    from social_api.modules.posts.schemas import PostUpdate

    with pytest.raises(PostForbiddenError):
        await svc.update(viewer_id=999, post_id=1, payload=PostUpdate(version=1, body="x"))


@pytest.mark.asyncio
async def test_update_version_conflict() -> None:
    post = _post(version=5)
    svc = PostsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeRepo(post)  # type: ignore[assignment]
    from social_api.modules.posts.schemas import PostUpdate

    with pytest.raises(OptimisticLockError) as ei:
        await svc.update(viewer_id=42, post_id=1, payload=PostUpdate(version=1, body="x"))
    assert ei.value.detail["current_version"] == 5
