"""Feed fan-out tasks (eager mode + fakeredis)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

import pytest

from social_api.modules.feed.cache import FEED_CACHE_CAP
from social_api.workers.tasks.feed_fanout import (
    _do_backfill,
    _do_fanout,
    is_celebrity,
)

pytestmark = pytest.mark.unit


_PipelineOp = (
    tuple[Literal["zadd"], str, dict[str, float]]
    | tuple[Literal["trim"], str, int, int]
    | tuple[Literal["expire"], str]
)


class _FakePipeline:
    def __init__(self, redis: _FakeRedis) -> None:
        self._redis = redis
        self._ops: list[_PipelineOp] = []

    def zadd(self, key: str, mapping: dict[str, float]) -> _FakePipeline:
        self._ops.append(("zadd", key, mapping))
        return self

    def zremrangebyrank(self, key: str, start: int, end: int) -> _FakePipeline:
        # Matches real Redis: rank range [start, end] ascending by score.
        self._ops.append(("trim", key, start, end))
        return self

    def expire(self, key: str, ttl: int) -> _FakePipeline:
        self._ops.append(("expire", key))
        return self

    async def execute(self) -> list[int]:
        results: list[int] = []
        for op in self._ops:
            if op[0] == "zadd":
                _, key, mapping = op
                self._redis.zsets.setdefault(key, {}).update(mapping)
                results.append(len(mapping))
            elif op[0] == "trim":
                _, key, start, end = op
                zs = self._redis.zsets.get(key, {})
                if not zs:
                    results.append(0)
                    continue
                ordered = sorted(zs.items(), key=lambda kv: kv[1])
                n = len(ordered)
                s = start if start >= 0 else max(0, n + start)
                e = end if end >= 0 else n + end
                if e < s or s >= n:
                    results.append(0)
                    continue
                doomed = {k for k, _ in ordered[s : e + 1]}
                self._redis.zsets[key] = {k: v for k, v in zs.items() if k not in doomed}
                results.append(len(doomed))
            elif op[0] == "expire":
                results.append(1)
        self._ops = []
        return results


class _FakeRedis:
    def __init__(self) -> None:
        self.zsets: dict[str, dict[str, float]] = {}

    def pipeline(self, *, transaction: bool = True) -> _FakePipeline:
        # The prod code passes transaction=True to document the
        # MULTI/EXEC ordering requirement (zadd → trim → expire). The
        # fake executes commands in order regardless — accept & ignore.
        return _FakePipeline(self)

    async def zadd(self, key: str, mapping: dict[str, float]) -> int:
        self.zsets.setdefault(key, {}).update(mapping)
        return len(mapping)


@pytest.mark.asyncio
async def test_do_fanout_writes_all_followers() -> None:
    redis = _FakeRedis()
    created = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    written = await _do_fanout(
        post_id=101,
        author_id=1,
        created_at_iso=created.isoformat(),
        follower_ids=[10, 11, 12],
        redis=redis,  # type: ignore[arg-type]
    )
    assert written == 3
    for fid in (10, 11, 12):
        assert f"feed:home:{fid}" in redis.zsets
        assert "101" in redis.zsets[f"feed:home:{fid}"]
    assert "101" in redis.zsets["feed:home:1"]


@pytest.mark.asyncio
async def test_do_fanout_trim_respects_cap() -> None:
    redis = _FakeRedis()
    key = "feed:home:10"
    redis.zsets[key] = {str(i): float(i) for i in range(FEED_CACHE_CAP)}
    created = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    await _do_fanout(
        post_id=999999,
        author_id=1,
        created_at_iso=created.isoformat(),
        follower_ids=[10],
        redis=redis,  # type: ignore[arg-type]
    )
    assert len(redis.zsets[key]) <= FEED_CACHE_CAP
    assert "999999" in redis.zsets[key]


@pytest.mark.asyncio
async def test_do_backfill_no_posts() -> None:
    redis = _FakeRedis()
    n = await _do_backfill(
        follower_id=1,
        followee_id=2,
        post_ids=[],
        created_ats=[],
        redis=redis,  # type: ignore[arg-type]
    )
    assert n == 0


@pytest.mark.asyncio
async def test_do_backfill_inserts_posts() -> None:
    redis = _FakeRedis()
    ts = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    n = await _do_backfill(
        follower_id=5,
        followee_id=6,
        post_ids=[1, 2, 3],
        created_ats=[ts, ts, ts],
        redis=redis,  # type: ignore[arg-type]
    )
    assert n == 3
    assert set(redis.zsets["feed:home:5"].keys()) == {"1", "2", "3"}


def test_is_celebrity_below_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    from social_api.config import get_settings

    monkeypatch.setenv("FEED_FANOUT_THRESHOLD", "5000")
    get_settings.cache_clear()
    assert is_celebrity(4999) is False
    get_settings.cache_clear()


def test_is_celebrity_at_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    from social_api.config import get_settings

    monkeypatch.setenv("FEED_FANOUT_THRESHOLD", "5000")
    get_settings.cache_clear()
    assert is_celebrity(5000) is True
    get_settings.cache_clear()
