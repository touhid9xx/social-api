"""Posts service visibility + optimistic lock + media projection."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.auth.models import User, UserRole
from social_api.modules.media.models import Media, MediaKind
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


def _media(mid: int, *, post_id: int | None) -> Media:
    return Media(
        id=mid,
        owner_id=42,
        post_id=post_id,
        message_id=None,
        sha256=f"{mid:064d}",
        mime="image/png",
        kind=MediaKind.IMAGE,
        size_bytes=1234,
        storage_key=f"media/{mid}.png",
        original_name="photo.png",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        deleted_at=None,
        version=1,
    )


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
    def __init__(self, post: Post | None, posts: list[Post] | None = None) -> None:
        self._p = post
        self._list = posts or []

    async def get_by_id(self, post_id: int) -> Post | None:
        return self._p

    async def save(self, post: Post) -> None:
        pass

    async def list_by_author(
        self,
        *,
        author_id: int,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Post]:
        return self._list[:limit]


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


class _FakeMediaRepo:
    """Records batches so tests can assert one query per feed page."""

    def __init__(self, rows: list[Media] | None = None) -> None:
        self._rows = rows or []
        self.calls: list[list[int]] = []

    async def list_by_post_ids(self, *, post_ids: list[int]) -> list[Media]:
        self.calls.append(list(post_ids))
        return [m for m in self._rows if m.post_id in post_ids]


class _FakeStorage:
    async def url_for(self, *, key: str) -> str:
        return f"/static/media/{key}"


def _svc(
    post: Post | None = None,
    *,
    posts: list[Post] | None = None,
    media: list[Media] | None = None,
) -> PostsService:
    """Service wired to fakes — no DB session, no real storage backend."""
    svc = PostsService(session=None)  # type: ignore[arg-type]
    svc._repo = _FakeRepo(post, posts)  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]
    svc._follows = _FakeFollows()  # type: ignore[assignment]
    svc._media_repo = _FakeMediaRepo(media)  # type: ignore[assignment]
    svc._storage = _FakeStorage()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_private_post_404_to_other_viewer() -> None:
    post = _post(visibility=Visibility.PRIVATE)
    svc = _svc(post)

    with pytest.raises(PostNotFoundError):
        await svc.get(viewer_id=999, post_id=1)


@pytest.mark.asyncio
async def test_private_post_visible_to_author() -> None:
    post = _post(visibility=Visibility.PRIVATE)
    svc = _svc(post)

    out = await svc.get(viewer_id=42, post_id=1)
    assert out.id == 1


@pytest.mark.asyncio
async def test_update_non_author_forbidden() -> None:
    post = _post()
    svc = _svc(post)
    from social_api.modules.posts.schemas import PostUpdate

    with pytest.raises(PostForbiddenError):
        await svc.update(viewer_id=999, post_id=1, payload=PostUpdate(version=1, body="x"))


@pytest.mark.asyncio
async def test_update_version_conflict() -> None:
    post = _post(version=5)
    svc = _svc(post)
    from social_api.modules.posts.schemas import PostUpdate

    with pytest.raises(OptimisticLockError) as ei:
        await svc.update(viewer_id=42, post_id=1, payload=PostUpdate(version=1, body="x"))
    assert ei.value.detail["current_version"] == 5


@pytest.mark.asyncio
async def test_get_projects_attached_media_in_upload_order() -> None:
    post = _post(media_count=2)
    svc = _svc(post, media=[_media(7, post_id=1), _media(8, post_id=1)])

    out = await svc.get(viewer_id=42, post_id=1)

    assert [m.id for m in out.media] == [7, 8]
    assert out.media[0].url == "/static/media/media/7.png"
    assert out.media[0].kind == "image"
    assert out.media_count == 2


@pytest.mark.asyncio
async def test_get_without_media_serializes_empty_list() -> None:
    post = _post()
    svc = _svc(post, media=[_media(7, post_id=99)])  # different post

    out = await svc.get(viewer_id=42, post_id=1)

    assert out.media == []  # never None — clients render unconditionally


@pytest.mark.asyncio
async def test_list_by_author_hydrates_media_with_one_query_per_page() -> None:
    posts = [_post(id=1), _post(id=2), _post(id=3)]
    svc = _svc(posts=posts, media=[_media(10, post_id=1), _media(11, post_id=3)])

    page = await svc.list_by_author(viewer_id=42, author_id=42, cursor=None, limit=20)

    assert [p.id for p in page.items] == [1, 2, 3]
    assert [m.id for m in page.items[0].media] == [10]
    assert page.items[1].media == []
    assert [m.id for m in page.items[2].media] == [11]
    # Exactly one SELECT for the whole page — no N+1.
    assert svc._media_repo.calls == [[1, 2, 3]]  # type: ignore[attr-defined]
