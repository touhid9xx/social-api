"""Feed home: celebrity read-merge path."""

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
    created_offset_sec: int = 0,
) -> Post:
    base = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    return Post(
        id=pid,
        author_id=author,
        body=f"post {pid}",
        visibility=Visibility.PUBLIC,
        media_count=0,
        like_count=0,
        comment_count=0,
        created_at=base - timedelta(seconds=created_offset_sec),
        updated_at=base - timedelta(seconds=created_offset_sec),
        deleted_at=None,
        version=1,
    )


class _Repo:
    def __init__(
        self,
        *,
        following: list[int],
        follower_counts: dict[int, int],
        zset_posts: list[Post],
        celebrity_posts: list[Post],
    ) -> None:
        self._following = following
        self._counts = follower_counts
        self._zset_posts = zset_posts
        self._celeb = celebrity_posts

    async def following_ids(self, *, user_id: int) -> list[int]:
        return list(self._following)

    async def follower_ids(self, *, user_id: int) -> list[int]:
        return []

    async def follower_counts_batch(self, *, user_ids: list[int]) -> dict[int, int]:
        return {uid: self._counts.get(uid, 0) for uid in user_ids}

    async def fetch_feed_posts_for_rebuild(self, *, user_id: int, cap: int) -> list[Post]:
        return self._zset_posts[:cap]

    async def fetch_posts_by_ids(self, *, post_ids: list[int]) -> list[Post]:
        by_id = {p.id: p for p in self._zset_posts}
        return [by_id[i] for i in post_ids if i in by_id]

    async def celebrity_following_posts(
        self,
        *,
        user_id: int,
        celebrity_ids: list[int],
        limit: int,
        before_ts: datetime | None = None,
    ) -> list[Post]:
        """Fake: mirror FeedRepository.celebrity_following_posts signature.

        Filter order:
          - only posts by celebrity_ids
          - only posts with created_at < before_ts (page 2+)
          - newest first
          - limit applied last
        """
        rows = [p for p in self._celeb if p.author_id in celebrity_ids]
        if before_ts is not None:
            rows = [p for p in rows if p.created_at < before_ts]
        rows.sort(key=lambda p: (p.created_at, p.id), reverse=True)
        return rows[:limit]

    async def blocked_with_author_ids(self, *, viewer_id: int, author_ids: list[int]) -> set[int]:
        return set()

    async def is_blocked_between(self, a: int, b: int) -> bool:
        return False


class _Cache:
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


class _Likes:
    async def exists_batch(self, **kw: Any) -> set[int]:
        return set()

    async def exists(self, **kw: Any) -> bool:
        return False


class _MediaRepo:
    """No attached media — this file asserts celebrity merging only."""

    async def list_by_post_ids(self, *, post_ids: Any) -> list[Any]:
        return []


class _Storage:
    async def url_for(self, *, key: str) -> str:
        return f"mem://{key}"


def _svc() -> FeedService:
    # Media hydration runs on every read path, so inject no-op fakes.
    svc = FeedService(session=None)  # type: ignore[arg-type]
    svc._media_repo = _MediaRepo()  # type: ignore[assignment]
    svc._storage = _Storage()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_celebrity_posts_merged_on_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Flag on
    monkeypatch.setenv("FF_FEED_FANOUT_ENABLED", "true")
    monkeypatch.setenv("FEED_FANOUT_THRESHOLD", "1000")
    from social_api.config import get_settings

    get_settings.cache_clear()

    normal_author = 2
    celeb_author = 3
    # Author 2 (normal, follower count 5) — post already in ZSET
    normal_post = _post(10, normal_author, created_offset_sec=100)
    # Author 3 (celebrity, follower count 5000) — post NOT in ZSET
    celeb_post = _post(20, celeb_author, created_offset_sec=50)

    repo = _Repo(
        following=[normal_author, celeb_author],
        follower_counts={normal_author: 5, celeb_author: 5000},
        zset_posts=[normal_post],
        celebrity_posts=[celeb_post],
    )
    cache = _Cache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.home(user_id=1, cursor=None, limit=10)
    ids = [p.id for p in page.items]
    # Celeb post (newer) should be first
    assert ids == [20, 10]

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_flag_off_skips_merge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FF_FEED_FANOUT_ENABLED", "false")
    from social_api.config import get_settings

    get_settings.cache_clear()

    normal_post = _post(10, 2, created_offset_sec=100)
    celeb_post = _post(20, 3, created_offset_sec=50)

    repo = _Repo(
        following=[2, 3],
        follower_counts={2: 5, 3: 5000},
        zset_posts=[normal_post],
        celebrity_posts=[celeb_post],
    )
    cache = _Cache()

    svc = _svc()
    svc._repo = repo  # type: ignore[assignment]
    svc._cache = cache  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]

    page = await svc.home(user_id=1, cursor=None, limit=10)
    # Only the ZSET post — no celebrity merge
    assert [p.id for p in page.items] == [10]

    get_settings.cache_clear()
