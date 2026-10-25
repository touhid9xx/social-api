"""Explore service behaviour with fakes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from social_api.modules.feed.service import FeedService
from social_api.modules.posts.models import Post
from social_api.modules.users.models import Visibility

pytestmark = pytest.mark.unit

BASE = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)


def _post(
    pid: int,
    author: int,
    *,
    visibility: Visibility = Visibility.PUBLIC,
    offset_min: int = 0,
) -> Post:
    return Post(
        id=pid,
        author_id=author,
        body=f"post {pid}",
        visibility=visibility,
        media_count=0,
        like_count=0,
        comment_count=0,
        created_at=BASE - timedelta(minutes=offset_min),
        updated_at=BASE - timedelta(minutes=offset_min),
        deleted_at=None,
        version=1,
    )


class _Repo:
    def __init__(
        self,
        *,
        source_posts: list[Post],
        fetched_posts: dict[int, Post],
        blocked: set[int] | None = None,
    ) -> None:
        self._source = source_posts
        self._fetched = fetched_posts
        self._blocked = blocked or set()

    async def trending_source_posts(self, *, created_after_epoch: float, limit: int) -> list[Post]:
        return self._source[:limit]

    async def fetch_posts_by_ids(self, *, post_ids: list[int]) -> list[Post]:
        return [self._fetched[i] for i in post_ids if i in self._fetched]

    async def blocked_with_author_ids(self, *, viewer_id: int, author_ids: list[int]) -> set[int]:
        return self._blocked & set(author_ids)


class _Cache:
    def __init__(self, entries: list[tuple[int, float]]) -> None:
        self._entries = entries

    async def explore_has_entries(self) -> bool:
        return bool(self._entries)

    async def get_explore_ids(self, *, limit: int) -> list[tuple[int, float]]:
        return self._entries[:limit]


class _Likes:
    async def exists_batch(self, **kw: Any) -> set[int]:
        return set()


@pytest.mark.asyncio
async def test_public_only_filtered() -> None:
    public = _post(1, author=10, visibility=Visibility.PUBLIC)
    private = _post(2, author=11, visibility=Visibility.PRIVATE)
    followers = _post(3, author=12, visibility=Visibility.FOLLOWERS)

    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._repo = _Repo(  # type: ignore[assignment]
        source_posts=[],
        fetched_posts={1: public, 2: private, 3: followers},
    )
    svc._cache = _Cache(entries=[(1, 10.0), (2, 9.0), (3, 8.0)])  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.explore(viewer_id=1, cursor=None, limit=10)
    ids = [p.id for p in page.items]
    assert ids == [1]


@pytest.mark.asyncio
async def test_blocked_author_filtered() -> None:
    a = _post(1, author=10)
    b = _post(2, author=11)

    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._repo = _Repo(  # type: ignore[assignment]
        source_posts=[],
        fetched_posts={1: a, 2: b},
        blocked={11},
    )
    svc._cache = _Cache(entries=[(1, 10.0), (2, 9.0)])  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.explore(viewer_id=1, cursor=None, limit=10)
    assert [p.id for p in page.items] == [1]


@pytest.mark.asyncio
async def test_cache_empty_falls_back_to_db() -> None:
    a = _post(1, author=10)
    b = _post(2, author=11)

    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._repo = _Repo(  # type: ignore[assignment]
        source_posts=[a, b],
        fetched_posts={1: a, 2: b},
    )
    svc._cache = _Cache(entries=[])  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.explore(viewer_id=1, cursor=None, limit=10)
    assert page.cache_hit is False
    assert [p.id for p in page.items] == [1, 2]


@pytest.mark.asyncio
async def test_cache_hit_flag_when_zset_populated() -> None:
    a = _post(1, author=10)
    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._repo = _Repo(  # type: ignore[assignment]
        source_posts=[], fetched_posts={1: a}
    )
    svc._cache = _Cache(entries=[(1, 10.0)])  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.explore(viewer_id=1, cursor=None, limit=10)
    assert page.cache_hit is True
