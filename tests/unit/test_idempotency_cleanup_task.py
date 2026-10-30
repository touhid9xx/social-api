"""`idempotency.cleanup` Beat task: batching, iteration cap, and logging."""

from __future__ import annotations

from typing import Any, cast

import pytest

from social_api.workers.tasks import idempotency_cleanup as task_mod

pytestmark = pytest.mark.unit


class _LogRecord:
    def __init__(self, event: str, **fields: Any) -> None:
        self.event = event
        self.fields = fields


class _Logger:
    def __init__(self) -> None:
        self.records: list[_LogRecord] = []

    def info(self, event: str, **fields: Any) -> None:
        self.records.append(_LogRecord(event, **fields))


class _Session:
    def __init__(self, owner: _Harness) -> None:
        self._owner = owner

    async def commit(self) -> None:
        self._owner.commits += 1

    async def __aenter__(self) -> _Session:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Repo:
    """Yields a scripted number of deleted rows per batch."""

    def __init__(self, session: Any, owner: _Harness) -> None:
        self._owner = owner

    async def delete_expired(self, *, before: Any, limit: int) -> int:
        self._owner.calls.append((before, limit))
        if not self._owner.script:
            return 0
        return self._owner.script.pop(0)


class _Harness:
    def __init__(self, script: list[int]) -> None:
        self.script = list(script)
        self.calls: list[tuple[Any, int]] = []
        self.commits = 0
        self.logger = _Logger()

    def sessionmaker(self) -> _Session:
        return _Session(self)


def _arm(monkeypatch: pytest.MonkeyPatch, harness: _Harness) -> None:
    monkeypatch.setattr(task_mod, "get_sessionmaker", lambda: harness.sessionmaker)
    monkeypatch.setattr(
        task_mod,
        "IdempotencyRepository",
        lambda session: _Repo(session, harness),
    )
    monkeypatch.setattr(task_mod, "logger", harness.logger)


@pytest.mark.asyncio
async def test_cleanup_stops_after_a_short_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    """A batch smaller than _BATCH means the table is drained."""
    harness = _Harness([task_mod._BATCH, 5])
    _arm(monkeypatch, harness)

    assert await task_mod._do_cleanup() == {"deleted": task_mod._BATCH + 5}
    assert len(harness.calls) == 2
    assert harness.commits == 2


@pytest.mark.asyncio
async def test_cleanup_commits_each_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = _Harness([1])
    _arm(monkeypatch, harness)

    await task_mod._do_cleanup()
    assert harness.commits == 1


@pytest.mark.asyncio
async def test_cleanup_is_capped_at_max_iterations(monkeypatch: pytest.MonkeyPatch) -> None:
    """A full table must not keep one Beat run alive forever."""
    harness = _Harness([task_mod._BATCH] * task_mod._MAX_ITERATIONS)
    _arm(monkeypatch, harness)

    assert await task_mod._do_cleanup() == {"deleted": task_mod._BATCH * task_mod._MAX_ITERATIONS}
    assert len(harness.calls) == task_mod._MAX_ITERATIONS


@pytest.mark.asyncio
async def test_cleanup_deletes_only_rows_expired_before_now(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _Harness([0])
    _arm(monkeypatch, harness)

    await task_mod._do_cleanup()

    before, limit = harness.calls[0]
    assert limit == task_mod._BATCH
    # MySQL columns are naive UTC, so the cutoff must be naive too.
    assert before.tzinfo is None


@pytest.mark.asyncio
async def test_cleanup_logs_only_when_something_was_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _Harness([0])
    _arm(monkeypatch, harness)
    await task_mod._do_cleanup()
    assert harness.logger.records == []

    harness = _Harness([7])
    _arm(monkeypatch, harness)
    await task_mod._do_cleanup()
    assert [r.event for r in harness.logger.records] == ["idempotency_cleanup_done"]
    assert harness.logger.records[0].fields == {"deleted": 7}


def test_task_is_registered_as_idempotency_cleanup() -> None:
    # Celery's factory is untyped, so the type checker sees a plain function.
    task = cast("Any", task_mod.cleanup_idempotency)
    assert task.name == "idempotency.cleanup"
