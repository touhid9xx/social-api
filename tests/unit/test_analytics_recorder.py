"""Visit recorder: path buckets, sampling, buffer bounds and flush semantics.

The recorder is deliberately fail-soft (analytics must never break a request),
so these tests pin the *silence* as much as the happy path: a dead DB, a dead
Redis and a failing consent query all have to end in "0 rows, no exception".
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from social_api.modules.analytics import recorder as rec
from social_api.modules.analytics.geo import GeoLocation
from social_api.modules.analytics.models import PathClass

pytestmark = pytest.mark.unit


# ----------------------------------------------------------------- helpers ---
def stub_settings(**overrides: Any) -> SimpleNamespace:
    """A settings stand-in: only the fields the recorder reads."""
    values: dict[str, Any] = {
        "analytics_enabled": True,
        "analytics_sample_rate": 1.0,
        "analytics_buffer_size": 200,
        "analytics_flush_seconds": 5.0,
        "analytics_retention_days": 90,
        "analytics_hash_salt": "",
        "app_name": "social-api",
        "api_v1_prefix": "/api/v1",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeResult:
    """Stand-in for `Result`: whichever accessor the caller uses."""

    def __init__(
        self,
        *,
        scalar: Any = 0,
        rows: list[Any] | None = None,
        one_row: tuple[Any, ...] = (0,),
        scalars_list: list[Any] | None = None,
    ) -> None:
        self._scalar = scalar
        self._rows = rows or []
        self._one = one_row
        self._scalars = scalars_list or []

    def scalar(self) -> Any:
        return self._scalar

    def all(self) -> list[Any]:
        # `scalars()` returns self, so both accessors read the same list.
        return list(self._rows or self._scalars)

    def one(self) -> tuple[Any, ...]:
        return self._one

    def scalars(self) -> FakeResult:
        return self


class ScriptedSession:
    """Async session whose `execute` replays a fixed list of results."""

    def __init__(self, results: list[FakeResult]) -> None:
        self._results = list(results)
        self.statements: list[Any] = []

    async def execute(self, stmt: Any) -> FakeResult:
        self.statements.append(stmt)
        return self._results.pop(0) if self._results else FakeResult()


class InsertSession:
    """Async session that records what `flush` tries to write."""

    def __init__(self, *, fail: bool = False) -> None:
        self.added: list[Any] = []
        self.committed = False
        self._fail = fail

    def add_all(self, rows: list[Any]) -> None:
        self.added.extend(rows)

    async def commit(self) -> None:
        if self._fail:
            raise RuntimeError("db down")
        self.committed = True


class SessionMaker:
    """Callable factory returning an async context manager over one session."""

    def __init__(self, session: Any) -> None:
        self.session = session
        self.calls = 0

    def __call__(self) -> SessionMaker:
        self.calls += 1
        return self

    async def __aenter__(self) -> Any:
        return self.session

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakePipe:
    def __init__(self, calls: list[tuple[Any, ...]], *, fail: bool = False) -> None:
        self.calls = calls
        self._fail = fail

    def pfadd(self, key: str, *members: str) -> FakePipe:
        self.calls.append(("pfadd", key, members))
        return self

    def expire(self, key: str, ttl: int) -> FakePipe:
        self.calls.append(("expire", key, ttl))
        return self

    async def execute(self) -> None:
        if self._fail:
            raise RuntimeError("redis down")
        self.calls.append(("execute",))


class FakeRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self._fail = fail

    def pipeline(self) -> FakePipe:
        return FakePipe(self.calls, fail=self._fail)


class FakeGeo:
    def __init__(self, location: GeoLocation | None = None) -> None:
        self.location = location
        self.seen: list[str | None] = []

    def resolve(self, ip: str | None) -> GeoLocation | None:
        self.seen.append(ip)
        return self.location


@pytest.fixture(autouse=True)
def _clean_state() -> Any:
    rec.reset()
    yield
    rec.reset()


def use_settings(monkeypatch: pytest.MonkeyPatch, **overrides: Any) -> SimpleNamespace:
    settings = stub_settings(**overrides)
    monkeypatch.setattr(rec, "get_settings", lambda: settings)
    return settings


# ------------------------------------------------------------ classification ---
@pytest.mark.parametrize(
    "path",
    [
        "/health",
        "/health/live",
        "/metrics",
        "/static/media/abc.jpg",
        "/docs",
        "/redoc",
        "/openapi.json",
        "/favicon.ico",
        "/_i18n_demo",
        "/api/v1/ws/notifications",
    ],
)
def test_infrastructure_paths_are_never_recorded(
    monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    use_settings(monkeypatch)
    assert rec.classify_path(path) is None


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/v1/auth/login", PathClass.AUTH),
        ("/api/v1/feed/home", PathClass.FEED),
        ("/api/v1/posts/12", PathClass.POSTS),
        ("/api/v1/comments/3", PathClass.COMMENTS),
        # likes live in the posts bucket on purpose: a like is post engagement.
        ("/api/v1/likes/posts/12", PathClass.POSTS),
        ("/api/v1/media/upload", PathClass.MEDIA),
        ("/api/v1/chat/rooms", PathClass.CHAT),
        ("/api/v1/search", PathClass.SEARCH),
        ("/api/v1/users/me", PathClass.PROFILE),
        ("/api/v1/follows/9", PathClass.PROFILE),
        ("/api/v1/gdpr/export", PathClass.PROFILE),
        ("/api/v1/presence/9", PathClass.PROFILE),
        ("/api/v1/notifications", PathClass.NOTIFICATIONS),
        ("/api/v1/admin/dashboard", PathClass.ADMIN),
        ("/api/v1/audit/me", PathClass.ADMIN),
        ("/api/v1/flags", PathClass.ADMIN),
        ("/api/v1/moderation/reports", PathClass.ADMIN),
    ],
)
def test_api_segments_map_to_path_classes(
    monkeypatch: pytest.MonkeyPatch, path: str, expected: PathClass
) -> None:
    use_settings(monkeypatch)
    assert rec.classify_path(path) == expected.value


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/unknown-thing/1",
        "/api/v1/",
        "/api/v1",
        "/preview-colors",
        "/",
    ],
)
def test_unmapped_paths_fall_back_to_other(monkeypatch: pytest.MonkeyPatch, path: str) -> None:
    use_settings(monkeypatch)
    assert rec.classify_path(path) == PathClass.OTHER.value


def test_prefix_boundary_needs_the_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    """`/api/v10/...` must not be mistaken for a v1 route."""
    use_settings(monkeypatch)
    assert rec.classify_path("/api/v10/posts") == PathClass.OTHER.value


# ---------------------------------------------------------- record_request ---
def test_record_request_is_a_noop_when_analytics_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch, analytics_enabled=False)
    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=12)
    assert rec.buffered_count() == 0


def test_record_request_skips_ignored_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch)
    rec.record_request(path="/metrics", status_code=200, latency_ms=1)
    assert rec.buffered_count() == 0


def test_record_request_captures_the_visit(monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch)
    rec.record_request(
        path="/api/v1/posts/12",
        status_code=201,
        latency_ms=-5,
        user_id=7,
        ip="8.8.8.8",
        user_agent="",
    )

    assert rec.buffered_count() == 1
    event = rec._buffer[0]
    assert event.day == datetime.now(UTC).date()
    assert event.path_class == PathClass.POSTS.value
    assert event.status_code == 201
    # Clamped: a negative duration would corrupt the p95 aggregate.
    assert event.latency_ms == 0
    assert event.weight == 1
    assert event.user_id == 7
    # Empty UA is normalized to NULL rather than persisted as "".
    assert event.user_agent is None


def test_buffer_ceiling_drops_instead_of_growing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch, analytics_buffer_size=1)

    for _ in range(rec._BUFFER_CEILING_FACTOR + 2):
        rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1)

    assert rec.buffered_count() == rec._BUFFER_CEILING_FACTOR
    assert rec._dropped == 2


# ------------------------------------------------------------ sample weight ---
def test_full_sample_rate_weighs_one(monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch, analytics_sample_rate=1.0)
    assert rec._sample_weight() == 1


def test_zero_sample_rate_records_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch, analytics_sample_rate=0.0)
    assert rec._sample_weight() is None


def test_fractional_rate_samples_and_weights(monkeypatch: pytest.MonkeyPatch) -> None:
    use_settings(monkeypatch, analytics_sample_rate=0.5)
    monkeypatch.setattr(rec, "random", SimpleNamespace(random=lambda: 0.1))
    assert rec._sample_weight() == 2

    monkeypatch.setattr(rec, "random", SimpleNamespace(random=lambda: 0.9))
    assert rec._sample_weight() is None


# ------------------------------------------------------------ visitor hash ---
@pytest.mark.parametrize("ip", [None, "", "127.0.0.1", "10.1.2.3", "::1", "not-an-ip"])
def test_visitor_hash_ignores_non_visitors(monkeypatch: pytest.MonkeyPatch, ip: str | None) -> None:
    use_settings(monkeypatch)
    assert rec._visitor_hash(ip, "UA", date(2024, 5, 1)) is None


def test_visitor_hash_is_opaque_and_rotates_daily(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    first = rec._visitor_hash("8.8.8.8", "UA", date(2024, 5, 1))
    again = rec._visitor_hash("8.8.8.8", "UA", date(2024, 5, 1))
    other_day = rec._visitor_hash("8.8.8.8", "UA", date(2024, 5, 2))

    assert first is not None
    assert len(first) == 64
    assert first == again
    # Yesterday's sketch cannot be joined with today's.
    assert first != other_day
    # The raw address never appears in the hash input on the wire.
    assert "8.8.8.8" not in first


def test_visitor_hash_honours_configured_salt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    unsalted = rec._visitor_hash("8.8.8.8", "UA", date(2024, 5, 1))

    use_settings(monkeypatch, analytics_hash_salt="pepper")
    salted = rec._visitor_hash("8.8.8.8", "UA", date(2024, 5, 1))

    assert unsalted != salted


# ------------------------------------------------------------------ consent ---
@pytest.mark.asyncio
async def test_consent_lookup_skips_the_database_for_anonymous_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode() -> Any:  # pragma: no cover - must never be reached
        raise AssertionError("no session expected")

    monkeypatch.setattr(rec, "get_sessionmaker", explode)
    assert await rec._granted_analytics_consent(set()) == set()


@pytest.mark.asyncio
async def test_consent_lookup_returns_only_granted_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = ScriptedSession([FakeResult(scalars_list=[1, 2])])
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(session))

    assert await rec._granted_analytics_consent({1, 2, 3}) == {1, 2}


# -------------------------------------------------------------------- flush ---
@pytest.mark.asyncio
async def test_flush_on_an_empty_buffer_does_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    assert await rec.flush() == 0


@pytest.mark.asyncio
async def test_flush_writes_consented_rows_and_pushes_unique_visitors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    session = InsertSession()
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(session))
    geo = FakeGeo(GeoLocation(country="BD", city="Dhaka", timezone="Asia/Dhaka"))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: geo)
    redis = FakeRedis()
    monkeypatch.setattr(rec, "get_redis", lambda: redis)

    async def consent(user_ids: set[int]) -> set[int]:
        return {7}

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=10)
    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=10, user_id=7)
    # Signed in but has not granted ANALYTICS: must never be persisted.
    rec.record_request(path="/api/v1/feed/home", status_code=200, latency_ms=10, user_id=8)

    assert await rec.flush() == 2
    assert session.committed is True
    assert [row.path_class for row in session.added] == [PathClass.POSTS.value] * 2
    assert {row.is_authenticated for row in session.added} == {False, True}
    assert session.added[0].country == "BD"
    assert session.added[0].city == "Dhaka"
    assert session.added[0].timezone == "Asia/Dhaka"
    # No identifiers on the row itself.
    assert not hasattr(session.added[0], "user_id")
    assert rec.buffered_count() == 0


@pytest.mark.asyncio
async def test_flush_pushes_one_hll_entry_per_day_for_global_ips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(InsertSession()))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())
    redis = FakeRedis()
    monkeypatch.setattr(rec, "get_redis", lambda: redis)

    async def consent(user_ids: set[int]) -> set[int]:
        return set()

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1, ip="8.8.8.8")
    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1, ip="8.8.4.4")

    assert await rec.flush() == 2

    today = datetime.now(UTC).date().isoformat()
    pushed = [call for call in redis.calls if call[0] == "pfadd"]
    # Both visitors land in the same day's set: one PFADD, not one per request.
    assert len(pushed) == 1
    assert pushed[0][1] == f"analytics:uv:{today}"
    assert len(pushed[0][2]) == 2
    expires = [call for call in redis.calls if call[0] == "expire"]
    assert expires
    assert expires[0][1] == f"analytics:uv:{today}"
    assert expires[0][2] == 90 * 86_400


@pytest.mark.asyncio
async def test_flush_is_silent_when_the_consent_query_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(InsertSession()))

    async def boom(user_ids: set[int]) -> set[int]:
        raise RuntimeError("mysql gone")

    monkeypatch.setattr(rec, "_granted_analytics_consent", boom)

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1)
    assert await rec.flush() == 0
    # The batch is dropped, not retried forever.
    assert rec.buffered_count() == 0


@pytest.mark.asyncio
async def test_flush_is_silent_when_the_insert_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(InsertSession(fail=True)))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())
    monkeypatch.setattr(rec, "get_redis", lambda: FakeRedis())

    async def consent(user_ids: set[int]) -> set[int]:
        return set()

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1)
    assert await rec.flush() == 0


@pytest.mark.asyncio
async def test_flush_survives_a_dead_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    """Rows still land in MySQL even when the HLL counters cannot be updated."""
    use_settings(monkeypatch)
    session = InsertSession()
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(session))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())
    monkeypatch.setattr(rec, "get_redis", lambda: FakeRedis(fail=True))

    async def consent(user_ids: set[int]) -> set[int]:
        return set()

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1, ip="8.8.8.8")
    assert await rec.flush() == 1
    assert session.committed is True


@pytest.mark.asyncio
async def test_flush_drops_authenticated_rows_without_consent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch)
    session = InsertSession()
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(session))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())

    async def consent(user_ids: set[int]) -> set[int]:
        return set()

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.record_request(path="/api/v1/feed/home", status_code=200, latency_ms=1, user_id=9)
    assert await rec.flush() == 0
    assert session.committed is False


# --------------------------------------------------------------- lifecycle ---
@pytest.mark.asyncio
async def test_start_is_idempotent_and_stop_drains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use_settings(monkeypatch, analytics_flush_seconds=0.05)
    session = InsertSession()
    monkeypatch.setattr(rec, "get_sessionmaker", SessionMaker(session))
    monkeypatch.setattr(rec, "get_geo_resolver", lambda: FakeGeo())

    async def consent(user_ids: set[int]) -> set[int]:
        return set()

    monkeypatch.setattr(rec, "_granted_analytics_consent", consent)

    rec.start()
    first_task = rec._task
    rec.start()  # second call must not spawn a second flusher
    assert rec._task is first_task

    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1)
    rec.record_request(path="/api/v1/posts", status_code=200, latency_ms=1)
    await asyncio.sleep(0.2)

    await rec.stop()
    assert rec._task is None
    # Whatever the loop did not drain, `stop()` did.
    assert rec.buffered_count() == 0
    assert session.committed is True or not session.added
