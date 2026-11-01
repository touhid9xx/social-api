"""Admin dashboard aggregates.

`DashboardService` is almost entirely SQL, so these tests drive it through two
boundaries instead of a database: a scripted session that answers the aggregate
queries by *shape*, and fake Redis/settings for the two sections that are
allowed to report `available=False`.

What is pinned here is the arithmetic and the failure policy — the parts a
future edit can silently get wrong:

* `_as_day` normalizes MySQL's `date` and SQLite's `'YYYY-MM-DD'` string,
* fixed-width series are zero-filled and stay in window order,
* the 95th percentile is a rank offset, not an average,
* regional shares are fractions of *all* weighted requests,
* `traffic`/`workers` say "unavailable" instead of lying with zeros.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

import pytest

import social_api.modules.admin_dashboard.service as dash
from social_api.modules.admin_dashboard.service import DashboardService, _as_day, _series
from social_api.modules.analytics.models import AnalyticsVisit
from social_api.modules.media.models import MediaKind

pytestmark = pytest.mark.unit

Shape = tuple[tuple[str, ...], str, int]


# ---------------------------------------------------------------------------
# Scripted session
# ---------------------------------------------------------------------------
class _Result:
    """The three shapes `DashboardService` consumes from an async result."""

    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def scalar(self) -> Any:
        return self._rows[0][0] if self._rows else None

    def one(self) -> tuple[Any, ...]:
        if not self._rows:
            raise AssertionError("execute().one() with no scripted row")
        return self._rows[0]

    def all(self) -> list[tuple[Any, ...]]:
        return list(self._rows)


def _shape(stmt: Any) -> Shape:
    """Identify a statement by its sources, first column and width.

    Keying on the *shape* rather than the full SQL text keeps the fake from
    duplicating the service's query text while still failing loudly if a new
    query appears with no scripted answer.
    """
    tables = tuple(
        getattr(src, "name", None) or type(src).__name__ for src in stmt.get_final_froms()
    )
    descs = stmt.column_descriptions
    first = str(descs[0].get("name")) if descs else ""
    return tables, first, len(descs)


class _Session:
    """Answers queries from a per-shape queue of result sets.

    One shape can be executed several times — every `_count_where` on the same
    table is the same shape — so entries are consumed in order and the last one
    repeats. An unscripted shape returns no rows, which is a real zero for a
    count and an empty list for a group-by.
    """

    def __init__(self, script: dict[Shape, list[list[tuple[Any, ...]]]]) -> None:
        self.script = script
        self.executed: list[Any] = []
        self.missed: set[Shape] = set()

    async def execute(self, stmt: Any) -> _Result:
        self.executed.append(stmt)
        shape = _shape(stmt)
        queue = self.script.get(shape)
        if not queue:
            self.missed.add(shape)
            return _Result([])
        if len(queue) == 1:
            return _Result(queue[0])
        return _Result(queue.pop(0))

    def analytics_queries(self) -> list[Any]:
        return [s for s in self.executed if _shape(s)[0] == ("analytics_visit",)]


class _Redis:
    """Raises unless a value was provided, so the "unavailable" paths are real."""

    def __init__(self, *, depth: int | None = None, visitors: int | None = None) -> None:
        self.depth = depth
        self.visitors = visitors
        self.pfcount_calls: list[tuple[str, ...]] = []
        self.llen_calls: list[str] = []

    async def llen(self, key: str) -> int:
        self.llen_calls.append(key)
        if self.depth is None:
            raise ConnectionError("redis down")
        return self.depth

    async def pfcount(self, *keys: str) -> int:
        self.pfcount_calls.append(keys)
        if self.visitors is None:
            raise ConnectionError("redis down")
        return self.visitors


@pytest.fixture
def redis_fake(monkeypatch: pytest.MonkeyPatch) -> _Redis:
    fake = _Redis()
    monkeypatch.setattr(dash, "get_redis", lambda: fake)
    return fake


def _settings(monkeypatch: pytest.MonkeyPatch, *, analytics_enabled: bool) -> None:
    settings = SimpleNamespace(analytics_enabled=analytics_enabled)
    monkeypatch.setattr(dash, "get_settings", lambda: settings)


# The statement shapes the service builds, named once so the scripts below
# read as intent rather than as tuples.
_USERS: Shape = (("users",), "count", 1)
_USERS_DAY: Shape = (("users",), "date", 2)
_POSTS_DAY: Shape = (("posts",), "date", 2)
_COMMENTS_DAY: Shape = (("comments",), "date", 2)
_MESSAGES_DAY: Shape = (("messages",), "date", 2)
_MEDIA: Shape = (("media",), "count", 1)
_MEDIA_BYTES: Shape = (("media",), "coalesce", 1)
_MEDIA_KIND: Shape = (("media",), "kind", 2)
_CONSUMERS: Shape = (("_ORMJoin",), "owner_id", 4)
_ANALYTICS_COUNT: Shape = (("analytics_visit",), "count", 1)
_ANALYTICS_TOTALS: Shape = (("analytics_visit",), "coalesce", 5)
_ANALYTICS_DAY: Shape = (("analytics_visit",), "day", 2)
_ANALYTICS_CLASS: Shape = (("analytics_visit",), "path_class", 4)
_ANALYTICS_REGION: Shape = (("analytics_visit",), "country", 4)
_ANALYTICS_LATENCY: Shape = (("analytics_visit",), "latency_ms", 1)


def _service(script: dict[Shape, list[list[tuple[Any, ...]]]] | None = None) -> DashboardService:
    return DashboardService(session=_Session(script or {}))  # type: ignore[arg-type]


def _session(service: DashboardService) -> _Session:
    # `session` is typed `AsyncSession`; an `isinstance` narrow here would be
    # flagged as unreachable, so cast to the fake we injected in `_service`.
    return cast(_Session, service.session)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------
def test_as_day_accepts_every_driver_shape() -> None:
    expected = date(2024, 5, 1)

    assert _as_day(datetime(2024, 5, 1, 23, 59, 59)) == expected
    assert _as_day(expected) == expected
    assert _as_day("2024-05-01") == expected
    # MySQL can hand back a full timestamp string for a DATE() expression.
    assert _as_day("2024-05-01T00:00:00") == expected


def test_series_zero_fills_the_window_in_order() -> None:
    start = date(2024, 5, 1)
    points = _series({start + timedelta(days=2): 3}, start, 4)

    assert [p.day for p in points] == [
        date(2024, 5, 1),
        date(2024, 5, 2),
        date(2024, 5, 3),
        date(2024, 5, 4),
    ]
    assert [p.value for p in points] == [0, 0, 3, 0]


def test_series_drops_days_outside_the_window() -> None:
    start = date(2024, 5, 1)
    points = _series({date(2024, 4, 30): 9, start: 1}, start, 2)

    assert [p.value for p in points] == [1, 0]


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_users_summary_counts_and_dense_signups() -> None:
    script: dict[Shape, list[list[tuple[Any, ...]]]] = {
        _USERS: [
            [(11,)],  # total — includes soft-deleted
            [(1,)],  # deleted
            [(9,)],  # active
            [(7,)],  # verified
            [(2,)],  # staff
            [(4,)],  # new in window
            [(3,)],  # previous window
            [(5,)],  # active 24h
            [(6,)],  # active 7d
            [(8,)],  # active 30d
        ],
        _USERS_DAY: [[("2024-05-02", 2)]],
    }
    service = _service(script)

    users = await service._users(
        start_day=date(2024, 5, 1),
        window_days=5,
        start_dt=datetime(2024, 5, 1),
        previous_start_dt=datetime(2024, 4, 26),
        now=datetime(2024, 5, 5, 12, 0),
    )

    assert users.total == 11
    assert users.deleted == 1
    assert users.active == 9
    assert users.verified == 7
    assert users.staff == 2
    assert users.new_in_window == 4
    assert users.new_previous_window == 3
    assert users.active_last_24h == 5
    assert users.active_last_7d == 6
    assert users.active_last_30d == 8
    # Sparse SQL rows become one point per day, so the chart never reflows.
    assert len(users.signups_by_day) == 5
    assert [p.value for p in users.signups_by_day] == [0, 2, 0, 0, 0]


@pytest.mark.asyncio
async def test_users_queries_never_touch_analytics() -> None:
    service = _service()

    await service._users(
        start_day=date(2024, 5, 1),
        window_days=2,
        start_dt=datetime(2024, 5, 1),
        previous_start_dt=datetime(2024, 4, 29),
        now=datetime(2024, 5, 2, 12, 0),
    )

    assert _session(service).analytics_queries() == []


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_content_sums_three_sources_into_one_activity_series() -> None:
    script = {
        _POSTS_DAY: [[("2024-05-01", 2), ("2024-05-02", 1)]],
        _COMMENTS_DAY: [[("2024-05-01", 4)]],
        _MESSAGES_DAY: [[("2024-05-03", 5)]],
    }
    service = _service(script)

    content = await service._content(
        start_day=date(2024, 5, 1), window_days=3, start_dt=datetime(2024, 5, 1)
    )

    # Posts + comments + messages land on the same day, and every day exists.
    assert [p.value for p in content.activity_by_day] == [6, 1, 5]


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_storage_splits_kinds_and_averages_per_owner() -> None:
    script: dict[Shape, list[list[tuple[Any, ...]]]] = {
        # media_count, users_with_media (same COUNT shape), then orphan_count
        _MEDIA: [[(4,)], [(2,)], [(1,)]],
        _MEDIA_BYTES: [
            [(4096,)],  # all live media
            [(512,)],  # orphans
        ],
        _MEDIA_KIND: [[(MediaKind.IMAGE, 3000), (MediaKind.VIDEO, 1096)]],
        _CONSUMERS: [
            [
                (7, "Alice", 3, 3000),
                (8, None, 1, 96),  # no Profile row: survives via the outer join
            ]
        ],
    }
    service = _service(script)

    storage = await service._storage()

    assert storage.media_count == 4
    assert storage.total_bytes == 4096
    assert storage.image_bytes == 3000
    assert storage.video_bytes == 1096
    assert storage.orphan_count == 1
    assert storage.orphan_bytes == 512
    assert storage.users_with_media == 2
    assert storage.average_bytes_per_user == 2048
    assert [c.user_id for c in storage.top_consumers] == [7, 8]
    assert storage.top_consumers[1].display_name is None


@pytest.mark.asyncio
async def test_storage_average_is_zero_without_media() -> None:
    service = _service({_MEDIA: [[(0,)]], _MEDIA_BYTES: [[(0,)]]})

    storage = await service._storage()

    assert storage.media_count == 0
    assert storage.average_bytes_per_user == 0


# ---------------------------------------------------------------------------
# Traffic
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_traffic_unavailable_when_analytics_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _settings(monkeypatch, analytics_enabled=False)
    service = _service()

    traffic = await service._traffic(start_day=date(2024, 5, 1), window_days=7)

    assert traffic.available is False
    assert traffic.requests == 0
    # Switched off means *no* query at all — not a query that returns nothing.
    assert _session(service).executed == []


@pytest.mark.asyncio
async def test_traffic_unavailable_when_nothing_recorded(
    monkeypatch: pytest.MonkeyPatch, redis_fake: _Redis
) -> None:
    _settings(monkeypatch, analytics_enabled=True)
    service = _service({_ANALYTICS_TOTALS: [[(0, 0, 0, 0, 0)]]})

    traffic = await service._traffic(start_day=date(2024, 5, 1), window_days=7)

    assert traffic.available is False
    assert traffic.requests_by_day == []
    assert traffic.by_class == []
    assert traffic.regions == []
    assert redis_fake.pfcount_calls == []


@pytest.mark.asyncio
async def test_traffic_weights_every_aggregate(
    monkeypatch: pytest.MonkeyPatch, redis_fake: _Redis
) -> None:
    _settings(monkeypatch, analytics_enabled=True)
    redis_fake.visitors = 77
    script: dict[Shape, list[list[tuple[Any, ...]]]] = {
        # requests, authenticated, errors, latency*weight, row_count
        _ANALYTICS_TOTALS: [[(200, 80, 10, 4000, 20)]],
        _ANALYTICS_DAY: [[("2024-05-01", 120), ("2024-05-02", 80)]],
        _ANALYTICS_CLASS: [[("FEED", 150, 4, 18.5)]],
        _ANALYTICS_REGION: [[("BD", "Dhaka", "Asia/Dhaka", 120), (None, None, None, 80)]],
        _ANALYTICS_COUNT: [[(20,)]],
        _ANALYTICS_LATENCY: [[(180,)]],
    }
    service = _service(script)

    traffic = await service._traffic(start_day=date(2024, 5, 1), window_days=2)

    assert traffic.available is True
    assert traffic.requests == 200
    assert traffic.authenticated_requests == 80
    assert traffic.error_requests == 10
    assert traffic.error_rate == 0.05
    # Sampling weights scale latency, so the average stays unbiased.
    assert traffic.avg_latency_ms == 20.0
    assert traffic.p95_latency_ms == 180
    assert traffic.unique_visitors == 77

    assert [(p.day, p.value) for p in traffic.requests_by_day] == [
        (date(2024, 5, 1), 120),
        (date(2024, 5, 2), 80),
    ]
    assert traffic.by_class[0].path_class == "FEED"
    assert traffic.by_class[0].avg_latency_ms == 18.5

    # Shares are of all weighted requests, so unresolved traffic dilutes them
    # and the listed rows intentionally do not sum to 1.0 when capped.
    assert [r.share for r in traffic.regions] == [0.6, 0.4]
    assert traffic.regions[1].country is None
    assert _session(service).missed == set()


@pytest.mark.asyncio
async def test_p95_uses_a_rank_offset_not_an_average() -> None:
    script = {
        _ANALYTICS_COUNT: [[(100,)]],
        _ANALYTICS_LATENCY: [[(420,)]],
    }
    service = _service(script)
    window = AnalyticsVisit.day >= date(2024, 5, 1)

    p95 = await service._p95_latency(window)

    assert p95 == 420
    sql = str(_session(service).executed[-1].compile(compile_kwargs={"literal_binds": True}))
    # ceil(100 * 0.95) - 1 == 94: the 95th-from-last of 100 ordered rows.
    assert "OFFSET 94" in sql
    assert "LIMIT 1" in sql


@pytest.mark.asyncio
async def test_p95_is_zero_without_rows() -> None:
    service = _service({_ANALYTICS_COUNT: [[(0,)]]})

    p95 = await service._p95_latency(AnalyticsVisit.day >= date(2024, 5, 1))

    assert p95 == 0
    # Only the row count ran; there was nothing to order.
    assert len(_session(service).executed) == 1


@pytest.mark.asyncio
async def test_unique_visitors_reads_one_hll_key_per_day(redis_fake: _Redis) -> None:
    redis_fake.visitors = 42
    service = _service()

    unique = await service._unique_visitors(date(2024, 5, 1), 3)

    assert unique == 42
    assert redis_fake.pfcount_calls == [
        (
            "analytics:uv:2024-05-01",
            "analytics:uv:2024-05-02",
            "analytics:uv:2024-05-03",
        )
    ]


@pytest.mark.asyncio
async def test_unique_visitors_is_zero_when_redis_fails(redis_fake: _Redis) -> None:
    service = _service()

    unique = await service._unique_visitors(date(2024, 5, 1), 2)

    assert unique == 0
    assert len(redis_fake.pfcount_calls) == 1


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_workers_reports_queue_depth(redis_fake: _Redis) -> None:
    redis_fake.depth = 12
    service = _service()

    workers = await service._workers()

    assert workers.available is True
    assert workers.queue_depth == 12
    assert redis_fake.llen_calls == ["celery"]


@pytest.mark.asyncio
async def test_workers_unavailable_when_redis_fails(redis_fake: _Redis) -> None:
    service = _service()

    workers = await service._workers()

    assert workers.available is False
    assert workers.queue_depth == 0


# ---------------------------------------------------------------------------
# Whole response
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_overview_returns_every_section_for_the_trailing_window(
    monkeypatch: pytest.MonkeyPatch, redis_fake: _Redis
) -> None:
    _settings(monkeypatch, analytics_enabled=False)
    redis_fake.depth = 0
    service = _service()

    overview = await service.overview(window_days=8)

    assert overview.window_days == 8
    assert overview.generated_at.tzinfo is not None
    # Trailing window ends today: a chart should not stop at yesterday.
    days = [p.day for p in overview.users.signups_by_day]
    assert len(days) == 8
    assert days[-1] == datetime.now(UTC).date()
    assert days[0] == days[-1] - timedelta(days=7)
    assert len(overview.content.activity_by_day) == 8
    assert overview.traffic.available is False
    assert overview.workers.available is True


@pytest.mark.asyncio
async def test_overview_reports_soft_deleted_rows_only_where_asked(
    monkeypatch: pytest.MonkeyPatch, redis_fake: _Redis
) -> None:
    """`total` counts soft-deleted rows; every other counter excludes them."""
    _settings(monkeypatch, analytics_enabled=False)
    service = _service({_USERS: [[(10,)], [(2,)], [(8,)]]})

    overview = await service.overview(window_days=3)

    assert overview.users.total == 10
    assert overview.users.deleted == 2
    assert overview.users.active == 8
