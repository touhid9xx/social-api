"""Search service logic with fake repositories."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.core.pagination import decode_cursor, encode_cursor
from social_api.exceptions import BadRequestError
from social_api.modules.posts.models import Post
from social_api.modules.search.repository import SearchUserRow, escape_like
from social_api.modules.search.service import MAX_USER_HITS, SearchService
from social_api.modules.users.models import Visibility

pytestmark = pytest.mark.unit

TS = datetime(2026, 1, 1, 12, 0, 0)


def _post(post_id: int, **overrides: Any) -> Post:
    base: dict[str, Any] = {
        "id": post_id,
        "author_id": 7,
        "body": "hello search",
        "visibility": Visibility.PUBLIC,
        "like_count": 0,
        "comment_count": 0,
        "media_count": 0,
        "version": 1,
        "created_at": TS,
        "updated_at": TS,
        "deleted_at": None,
    }
    base.update(overrides)
    return Post(**base)


class _Repo:
    def __init__(self, posts: list[Post], users: list[SearchUserRow] | None = None) -> None:
        self.posts = posts
        self.users = users or []
        self.post_calls: list[dict[str, Any]] = []
        self.user_calls: list[dict[str, Any]] = []

    async def search_posts(self, **kwargs: Any) -> list[Post]:
        self.post_calls.append(kwargs)
        return list(self.posts)

    async def search_users(self, *, term: str, limit: int) -> list[SearchUserRow]:
        self.user_calls.append({"term": term, "limit": limit})
        return list(self.users)[:limit]


class _Likes:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def exists_batch(self, **kwargs: Any) -> set[int]:
        self.calls.append(kwargs)
        return set()


async def _no_media(*_args: Any, **_kwargs: Any) -> dict[int, list[Any]]:
    return {}


def _service(repo: _Repo, monkeypatch: pytest.MonkeyPatch) -> SearchService:
    monkeypatch.setattr(
        "social_api.modules.search.service.media_by_post",
        _no_media,
    )
    monkeypatch.setattr(
        "social_api.modules.search.service.get_storage_backend",
        lambda: None,
    )
    svc = SearchService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._likes = _Likes()  # type: ignore[assignment]
    return svc


# ---- term validation -------------------------------------------------------


@pytest.mark.asyncio
async def test_short_term_rejected_without_querying(monkeypatch: pytest.MonkeyPatch) -> None:
    """One usable character would match most of the table — reject before SQL."""
    repo = _Repo([])
    svc = _service(repo, monkeypatch)

    with pytest.raises(BadRequestError) as exc:
        await svc.search(viewer_id=1, query="  a  ", cursor=None, limit=None)

    assert exc.value.detail["code"] == "QUERY_TOO_SHORT"
    assert repo.post_calls == []
    assert repo.user_calls == []


@pytest.mark.asyncio
async def test_term_is_trimmed_before_querying(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _Repo([])
    svc = _service(repo, monkeypatch)

    result = await svc.search(viewer_id=1, query="  cats  ", cursor=None, limit=None)

    assert result.query == "cats"
    assert repo.post_calls[0]["term"] == "cats"
    assert repo.user_calls[0]["term"] == "cats"


# ---- LIKE escaping ---------------------------------------------------------


def test_escape_like_neutralises_wildcards() -> None:
    """`%` and `_` must match literally, not as wildcards."""
    assert escape_like("100%") == "100\\%"
    assert escape_like("a_b") == "a\\_b"


def test_escape_like_escapes_backslash_first() -> None:
    """A trailing backslash must not swallow the next escape sequence."""
    assert escape_like("a\\b") == "a\\\\b"


# ---- pagination ------------------------------------------------------------


@pytest.mark.asyncio
async def test_next_cursor_emitted_when_more_posts_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Over-fetch by one is the only signal that another page exists."""
    repo = _Repo([_post(3), _post(2)])
    svc = _service(repo, monkeypatch)

    result = await svc.search(viewer_id=1, query="hi", cursor=None, limit=1)

    assert len(result.posts) == 1
    assert result.next_cursor is not None
    assert decode_cursor(result.next_cursor)[1] == 3


@pytest.mark.asyncio
async def test_no_cursor_on_exact_fit(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _Repo([_post(3)])
    svc = _service(repo, monkeypatch)

    result = await svc.search(viewer_id=1, query="hi", cursor=None, limit=1)

    assert len(result.posts) == 1
    assert result.next_cursor is None


@pytest.mark.asyncio
async def test_cursor_is_forwarded_to_repository(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _Repo([])
    svc = _service(repo, monkeypatch)
    cursor = encode_cursor([TS, 9])

    await svc.search(viewer_id=1, query="hi", cursor=cursor, limit=None)

    call = repo.post_calls[0]
    # `decode_cursor` returns an ISO-8601 string with an offset, so the decoded
    # datetime is tz-aware — the same shape every other keyset service gets.
    assert call["cursor_ts"] == TS.replace(tzinfo=UTC)
    assert call["cursor_id"] == 9


@pytest.mark.asyncio
async def test_malformed_cursor_is_a_400_not_a_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """A tampered cursor must be rejected as INVALID_CURSOR, before any query."""
    repo = _Repo([])
    svc = _service(repo, monkeypatch)

    with pytest.raises(BadRequestError) as exc:
        await svc.search(viewer_id=1, query="hi", cursor="not-a-cursor", limit=None)

    assert exc.value.detail["code"] == "INVALID_CURSOR"
    assert repo.post_calls == []


# ---- limits ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_people_section_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    """A large post `limit` must not inflate the people shortlist."""
    users = [
        SearchUserRow(user_id=i, display_name=f"user{i}", avatar_url=None)
        for i in range(MAX_USER_HITS + 5)
    ]
    repo = _Repo([], users)
    svc = _service(repo, monkeypatch)

    result = await svc.search(viewer_id=1, query="user", cursor=None, limit=100)

    assert repo.user_calls[0]["limit"] == MAX_USER_HITS
    assert len(result.users) == MAX_USER_HITS


@pytest.mark.asyncio
async def test_default_limit_applied_to_posts(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _Repo([])
    svc = _service(repo, monkeypatch)

    await svc.search(viewer_id=1, query="hi", cursor=None, limit=None)

    assert repo.post_calls[0]["limit"] == 20
