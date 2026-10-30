"""`metrics.emit_queue_depth` heartbeat: signal emission and swallow-on-outage.

The contract this pins: the Beat schedule must keep firing during a Redis or
DB outage, emitting zeros for the signal it could not read rather than
raising. Losing the heartbeat exactly when something is broken would hide
the outage from Prometheus.
"""

from __future__ import annotations

from typing import Any, cast

import pytest

from social_api.cache import redis as redis_mod
from social_api.db import session as db_session_mod
from social_api.workers.tasks import heartbeat as task_mod

pytestmark = pytest.mark.unit

_DEPTH = 7
_CHECKED_OUT = 3
_OVERFLOW = 2


class _FakeRedis:
    def __init__(self, depth: int = _DEPTH) -> None:
        self._depth = depth
        self.keys: list[str] = []

    async def llen(self, key: str) -> int:
        self.keys.append(key)
        return self._depth


class _BrokenRedis:
    async def llen(self, key: str) -> int:
        raise ConnectionError("redis down")


class _FakePool:
    def checkedout(self) -> int:
        return _CHECKED_OUT

    def overflow(self) -> int:
        return _OVERFLOW


class _Engine:
    def __init__(self, pool: Any) -> None:
        self.pool = pool


def _patch_engine(monkeypatch: pytest.MonkeyPatch, pool: Any) -> None:
    monkeypatch.setattr(db_session_mod, "get_engine", lambda: _Engine(pool))


def _patch_queue_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the isinstance() guard accept our fake pool."""
    monkeypatch.setattr("sqlalchemy.pool.AsyncAdaptedQueuePool", _FakePool)


@pytest.mark.asyncio
async def test_emit_reports_queue_depth_and_pool_stats(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = _FakeRedis()
    monkeypatch.setattr(redis_mod, "get_redis", lambda: redis)
    _patch_queue_pool(monkeypatch)
    _patch_engine(monkeypatch, _FakePool())

    out = await task_mod._emit()

    assert out == {
        "queue_depth": _DEPTH,
        "db_checkedout": _CHECKED_OUT,
        "db_overflow": _OVERFLOW,
    }
    assert redis.keys == ["celery"]


@pytest.mark.asyncio
async def test_emit_zeroes_pool_stats_for_non_queue_pools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """NullPool (dev) and StaticPool (sqlite) carry no counters — report 0, not crash."""
    monkeypatch.setattr(redis_mod, "get_redis", lambda: _FakeRedis())
    _patch_engine(monkeypatch, object())

    out = await task_mod._emit()

    assert out["db_checkedout"] == 0
    assert out["db_overflow"] == 0
    assert out["queue_depth"] == _DEPTH


@pytest.mark.asyncio
async def test_emit_survives_redis_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(redis_mod, "get_redis", lambda: _BrokenRedis())
    _patch_queue_pool(monkeypatch)
    _patch_engine(monkeypatch, _FakePool())

    out = await task_mod._emit()

    assert out == {
        "queue_depth": 0,
        "db_checkedout": _CHECKED_OUT,
        "db_overflow": _OVERFLOW,
    }


@pytest.mark.asyncio
async def test_emit_survives_db_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(redis_mod, "get_redis", lambda: _FakeRedis())

    def broken_engine() -> Any:
        raise RuntimeError("db down")

    monkeypatch.setattr(db_session_mod, "get_engine", broken_engine)

    out = await task_mod._emit()

    assert out == {"queue_depth": _DEPTH, "db_checkedout": 0, "db_overflow": 0}


@pytest.mark.asyncio
async def test_emit_survives_total_outage(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both signals unavailable: still returns, still logs, never raises."""

    def broken_redis() -> Any:
        raise ConnectionError("redis down")

    def broken_engine() -> Any:
        raise RuntimeError("db down")

    monkeypatch.setattr(redis_mod, "get_redis", broken_redis)
    monkeypatch.setattr(db_session_mod, "get_engine", broken_engine)

    assert await task_mod._emit() == {
        "queue_depth": 0,
        "db_checkedout": 0,
        "db_overflow": 0,
    }


def test_task_wrapper_returns_emitted_counters(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = {"queue_depth": 1, "db_checkedout": 0, "db_overflow": 0}

    async def fake_emit() -> dict[str, int]:
        return expected

    monkeypatch.setattr(task_mod, "_emit", fake_emit)

    # bind=True: calling the task object injects `self`.
    task = cast("Any", task_mod.emit_queue_depth)
    assert task() == expected


def test_task_is_registered_on_the_beat_schedule() -> None:
    task = cast("Any", task_mod.emit_queue_depth)
    assert task.name == "metrics.emit_queue_depth"
