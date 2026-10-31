"""Feed service: cache-miss rebuild, cache-hit read, pagination."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from social_api.modules.feed.service import FeedService
from social_api.modules.posts.models import Post
from social_api.modules.users.models import Visibility

pytestmark = pytest.mark.unit


def _post(
    pid: int,
    author: int,
    *,
    visibility: Visibility = Visibility.PUBLIC,
    created_offset_min: int = 0,
) -> Post:
    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    p = Post(
        id=pid,
        author_id=author,
        body=f"post {pid}",
        visibility=visibility,
        media_count=0,
        like_count=0,
        comment_count=0,
        created_at=base - timedelta(minutes=created_offset_min),
        updated_at=base - timedelta(minutes=created_offset_min),
        deleted_at=None,
        version=1,
    )
    return p


class _FakeRepo:
    def __init__(
        self,
        *,
        following: list[int],
        posts: list[Post],
        blocked_author_ids: set[int] | None = None,
    ) -> None:
        self._following = following
        self._posts = sorted(posts, key=lambda p: (p.created_at, p.id), reverse=True)
        self._blocked = blocked_author_ids or set()

    async def following_ids(self, *, user_id: int) -> list[int]:
        return list(self._following)

    async def follower_ids(self, *, user_id: int) -> list[int]:
        return []

    async def fetch_feed_posts_for_rebuild(self, *, user_id: int, cap: int) -> list[Post]:
        author_set = set(self._following) | {user_id}
        return [p for p in self._posts if p.author_id in author_set][:cap]

    async def fetch_posts_by_ids(self, *, post_ids: list[int]) -> list[Post]:
        by_id = {p.id: p for p in self._posts}
        return [by_id[i] for i in post_ids if i in by_id]

    async def blocked_with_author_ids(self, *, viewer_id: int, author_ids: list[int]) -> set[int]:
        return self._blocked & set(author_ids)

    async def is_blocked_between(self, a: int, b: int) -> bool:
        return b in self._blocked or a in self._blocked


class _FakeCache:
    def __init__(self) -> None:
        self.store: dict[int, list[tuple[int, float]]] = {}

    async def get_ids(self, *, user_id: int, limit: int) -> list[tuple[int, float]]:
        return self.store.get(user_id, [])[:limit]

    async def replace(
        self,
        *,
        user_id: int,
        entries: list[tuple[int, datetime]],
    ) -> None:
        entries_sorted = sorted(entries, key=lambda e: e[1], reverse=True)
        self.store[user_id] = [(pid, dt.timestamp()) for pid, dt in entries_sorted]

    async def append(self, *, user_id: int, post_id: int, created_at: datetime) -> None:
        self.store.setdefault(user_id, []).insert(0, (post_id, created_at.timestamp()))

    async def invalidate(self, *, user_id: int) -> None:
        self.store.pop(user_id, None)

    async def invalidate_many(self, *, user_ids: list[int]) -> None:
        for u in user_ids:
            self.store.pop(u, None)


class _FakeLikes:
    async def exists_batch(self, **kw: Any) -> set[int]:
        return set()

    async def exists(self, **kw: Any) -> bool:
        return False


class _FakeMediaRepo:
    """No attached media — this file asserts ordering, not media."""

    def __init__(self) -> None:
        self.calls: list[list[int]] = []

    async def list_by_post_ids(self, *, post_ids: Any) -> list[Any]:
        self.calls.append(list(post_ids))
        return []


class _FakeStorage:
    async def url_for(self, *, key: str) -> str:
        return f"mem://{key}"


def _svc() -> FeedService:
    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._media_repo = _FakeMediaRepo()  # type: ignore[assignment]
    svc._storage = _FakeStorage()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_cache_miss_rebuild_and_cache_write() -> None:
    posts = [
        _post(1, author=2, created_offset_min=0),
        _post(2, author=2, created_offset_min=5),
        _post(3, author=99, created_offset_min=1),  # not followed -> excluded
    ]
    repo = _FakeRepo(following=[2], posts=posts)
    cache = _FakeCache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]

    page = await svc.home(user_id=1, cursor=None, limit=10)
    assert page.cache_hit is False
    assert [p.id for p in page.items] == [1, 2]
    assert cache.store.get(1) is not None


@pytest.mark.asyncio
async def test_cache_hit_path() -> None:
    posts = [_post(1, author=2, created_offset_min=0)]
    repo = _FakeRepo(following=[2], posts=posts)
    cache = _FakeCache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]

    # Warm cache
    await svc.home(user_id=1, cursor=None, limit=10)

    # Second call -> cache hit
    page = await svc.home(user_id=1, cursor=None, limit=10)
    assert page.cache_hit is True
    assert [p.id for p in page.items] == [1]


@pytest.mark.asyncio
async def test_private_post_from_unfollowed_hidden() -> None:
    # A private post by author 2 (followed) but author 2 in blocked list
    posts = [_post(1, author=2, visibility=Visibility.PRIVATE)]
    repo = _FakeRepo(following=[2], posts=posts, blocked_author_ids={2})
    cache = _FakeCache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]

    page = await svc.home(user_id=1, cursor=None, limit=10)
    assert page.items == []


@pytest.mark.asyncio
async def test_own_private_posts_included() -> None:
    posts = [_post(1, author=1, visibility=Visibility.PRIVATE)]  # own post
    repo = _FakeRepo(following=[], posts=posts)
    cache = _FakeCache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]

    page = await svc.home(user_id=1, cursor=None, limit=10)
    assert [p.id for p in page.items] == [1]


@pytest.mark.asyncio
async def test_media_hydration_costs_one_query_per_page() -> None:
    """A page of N posts must not turn into N media queries."""
    posts = [
        _post(1, author=2, created_offset_min=0),
        _post(2, author=2, created_offset_min=5),
    ]
    repo = _FakeRepo(following=[2], posts=posts)
    cache = _FakeCache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _FakeLikes()  # type: ignore[assignment]

    await svc.home(user_id=1, cursor=None, limit=10)
    assert svc._media_repo.calls == [[1, 2]]  # type: ignore[attr-defined]
