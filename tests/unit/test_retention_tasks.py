"""Retention purge tasks: batching, cutoffs, audit emission, best-effort I/O.

These tasks hard-delete user data, so the logic under test is the *control
flow*: how a batch is drained, when the loop stops, what gets audited, and
which failures are survivable. SQL itself is exercised by the integration
suite; here the session is a scripted fake so each branch is reachable
without a database.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, NamedTuple

import pytest

from social_api.workers.tasks import retention

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class _MediaRow(NamedTuple):
    id: int
    storage_key: str


class _Result:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Result:
        return self

    def all(self) -> list[Any]:
        return list(self._rows)


class _Session:
    def __init__(self, harness: _Harness) -> None:
        self._h = harness

    async def execute(self, stmt: Any) -> _Result:
        text = str(stmt)
        self._h.statements.append(text)
        if not text.lstrip().upper().startswith("DELETE"):
            return _Result(self._h.rows_for(text))

        self._h.deletes.append(text)
        self._h.delete_count += 1
        if self._h.delete_count in self._h.fail_on_delete:
            raise RuntimeError("statement failed")
        return _Result([])

    async def commit(self) -> None:
        self._h.commits += 1

    async def rollback(self) -> None:
        self._h.rollbacks += 1

    async def __aenter__(self) -> _Session:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _Harness:
    """Scripted sessionmaker: SELECTs yield canned rows, DELETEs are recorded."""

    def __init__(self, rows_for: Callable[[str], list[Any]] | None = None) -> None:
        self._rows_for = rows_for or (lambda _text: [])
        self.statements: list[str] = []
        self.deletes: list[str] = []
        self.delete_count = 0
        self.fail_on_delete: set[int] = set()
        self.commits = 0
        self.rollbacks = 0
        self.sessions = 0

    def rows_for(self, text: str) -> list[Any]:
        return self._rows_for(text)

    def sessionmaker(self) -> _Session:
        self.sessions += 1
        return _Session(self)


class _Audit:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, **fields: Any) -> None:
        self.calls.append(fields)


class _Storage:
    def __init__(self, *, fail: bool = False) -> None:
        self.deleted: list[str] = []
        self._fail = fail

    async def delete(self, *, key: str) -> None:
        if self._fail:
            raise OSError("s3 unavailable")
        self.deleted.append(key)


class _Due(NamedTuple):
    id: int
    user_id: int


class _DeletionRepo:
    """Stands in for the real `DeletionRepository` used by `_do_purge_users`."""

    def __init__(self, harness: _UserHarness) -> None:
        self._h = harness

    async def list_due(self, *, cutoff: Any, limit: int) -> list[_Due]:
        self._h.cutoffs.append(cutoff)
        return list(self._h.due)

    async def mark_completed(self, *, request_id: int) -> bool:
        self._h.completed_calls.append(request_id)
        if not self._h.completed:
            return False
        return self._h.completed.pop(0)


class _UserHarness(_Harness):
    def __init__(self, due: list[_Due], completed: list[bool]) -> None:
        super().__init__()
        self.due = due
        self.completed = completed
        self.completed_calls: list[int] = []
        self.cutoffs: list[Any] = []


def _queue(*batches: list[Any]) -> Callable[[str], list[Any]]:
    """Yield one canned batch per SELECT, then empty (drained table)."""
    remaining = list(batches)

    def rows_for(_text: str) -> list[Any]:
        return remaining.pop(0) if remaining else []

    return rows_for


def _arm(
    monkeypatch: pytest.MonkeyPatch,
    harness: _Harness,
    audit: _Audit,
) -> None:
    # `get_sessionmaker()` itself returns the factory, so patch with a lambda.
    monkeypatch.setattr(retention, "get_sessionmaker", lambda: harness.sessionmaker)
    monkeypatch.setattr(retention, "_write_audit", audit)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_notifications_purge_stops_after_a_short_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _Harness(_queue([1, 2, 3]))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_notifications() == {"purged": 3}
    assert harness.commits == 1
    assert len(harness.deletes) == 1
    assert audit.calls == [
        {
            "action": "RETENTION_NOTIFICATIONS_PURGED",
            "entity": "notification",
            "entity_id": None,
            "after": {"count": 3},
        }
    ]


@pytest.mark.asyncio
async def test_notifications_purge_drains_full_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A full batch means "maybe more" — keep going until a short one arrives."""
    harness = _Harness(_queue(list(range(retention._BATCH)), [1000, 1001]))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_notifications() == {"purged": retention._BATCH + 2}
    assert harness.commits == 2
    assert audit.calls[0]["after"] == {"count": retention._BATCH + 2}


@pytest.mark.asyncio
async def test_notifications_purge_noop_when_nothing_matched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _Harness(_queue([]))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_notifications() == {"purged": 0}
    assert harness.commits == 0
    assert harness.deletes == []
    assert audit.calls == []


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_audit_purge_deletes_due_rows_and_audits_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Purging audit rows is itself audited, so retention runs leave a trace."""
    harness = _Harness(_queue(list(range(retention._BATCH))))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_audit() == {"purged": retention._BATCH}
    assert harness.commits == 1
    assert audit.calls[0]["action"] == "RETENTION_AUDIT_PURGED"
    assert audit.calls[0]["entity"] == "audit_log"


# ---------------------------------------------------------------------------
# Orphan media
# ---------------------------------------------------------------------------
def _arm_storage(monkeypatch: pytest.MonkeyPatch, storage: Any) -> None:
    from social_api.modules.media import service as media_service

    monkeypatch.setattr(media_service, "get_storage_backend", lambda: storage)


@pytest.mark.asyncio
async def test_orphan_media_deletes_rows_then_storage_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [_MediaRow(1, "a.png"), _MediaRow(2, "b.png")]
    harness = _Harness(_queue(rows))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)
    storage = _Storage()
    _arm_storage(monkeypatch, storage)

    assert await retention._do_purge_orphan_media() == {"purged": 2}
    assert harness.deletes
    assert storage.deleted == ["a.png", "b.png"]
    assert audit.calls[0]["action"] == "RETENTION_ORPHAN_MEDIA_PURGED"


@pytest.mark.asyncio
async def test_orphan_media_survives_a_failing_storage_delete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The DB row is the source of truth; a stale file must not fail the batch."""
    rows = [_MediaRow(1, "a.png")]
    harness = _Harness(_queue(rows))
    _arm(monkeypatch, harness, _Audit())
    _arm_storage(monkeypatch, _Storage(fail=True))

    assert await retention._do_purge_orphan_media() == {"purged": 1}


@pytest.mark.asyncio
async def test_orphan_media_purges_rows_when_storage_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [_MediaRow(1, "a.png")]
    harness = _Harness(_queue(rows))
    _arm(monkeypatch, harness, _Audit())

    from social_api.modules.media import service as media_service

    def broken() -> Any:
        raise RuntimeError("no storage backend")

    monkeypatch.setattr(media_service, "get_storage_backend", broken)

    assert await retention._do_purge_orphan_media() == {"purged": 1}


# ---------------------------------------------------------------------------
# Chat messages
# ---------------------------------------------------------------------------
def _messages_handler(member_read_ids: list[Any]) -> Callable[[str], list[Any]]:
    """Two SELECT shapes interleave: message batches and per-room read state."""

    def rows_for(text: str) -> list[Any]:
        if "chat_room_members" in text:
            return member_read_ids
        return [(10, 1), (11, 1)]

    return rows_for


@pytest.mark.asyncio
async def test_messages_purge_deletes_only_fully_read_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Message 10 was read by everyone (last_read=10); 11 was not (10 < 11)."""
    harness = _Harness(_messages_handler([10]))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_read_messages() == {"purged": 1}
    assert len(harness.deletes) == 1
    assert audit.calls[0]["action"] == "RETENTION_MESSAGES_PURGED"


@pytest.mark.asyncio
async def test_messages_purge_keeps_messages_a_member_never_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _Harness(_messages_handler([None]))
    audit = _Audit()
    _arm(monkeypatch, harness, audit)

    assert await retention._do_purge_read_messages() == {"purged": 0}
    assert harness.deletes == []
    assert harness.commits == 0
    assert audit.calls == []


# ---------------------------------------------------------------------------
# Users past the hard-delete window
# ---------------------------------------------------------------------------
def _arm_users(
    monkeypatch: pytest.MonkeyPatch,
    harness: _UserHarness,
    audit: _Audit,
) -> None:
    monkeypatch.setattr(retention, "get_sessionmaker", lambda: harness.sessionmaker)
    monkeypatch.setattr(retention, "_write_audit", audit)
    monkeypatch.setattr(
        retention,
        "DeletionRepository",
        lambda _session: _DeletionRepo(harness),
    )


@pytest.mark.asyncio
async def test_users_purge_counts_only_requests_it_completed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`mark_completed` is atomic: if the row already moved on, don't count it."""
    harness = _UserHarness(due=[_Due(1, 7), _Due(2, 8)], completed=[True, False])
    audit = _Audit()
    _arm_users(monkeypatch, harness, audit)

    assert await retention._do_purge_users() == {"purged": 1}
    assert harness.completed_calls == [1, 2]
    # One transaction for the listing, one per due request.
    assert harness.sessions == 3
    assert audit.calls == [
        {"action": "USER_HARD_DELETED", "entity": "user", "entity_id": 7},
    ]


@pytest.mark.asyncio
async def test_users_purge_isolates_a_failing_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One user's failure must not abort the rest of the batch."""
    harness = _UserHarness(due=[_Due(1, 7), _Due(2, 8)], completed=[True])
    audit = _Audit()
    _arm_users(monkeypatch, harness, audit)
    harness.fail_on_delete = {1}

    assert await retention._do_purge_users() == {"purged": 1}
    assert harness.rollbacks == 1
    assert harness.commits == 1
    assert audit.calls[0]["entity_id"] == 8


@pytest.mark.asyncio
async def test_users_purge_noop_when_nothing_is_due(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    harness = _UserHarness(due=[], completed=[])
    audit = _Audit()
    _arm_users(monkeypatch, harness, audit)

    assert await retention._do_purge_users() == {"purged": 0}
    assert harness.commits == 0
    assert audit.calls == []


# ---------------------------------------------------------------------------
# Celery wrappers
# ---------------------------------------------------------------------------
_WRAPPERS = [
    ("purge_soft_deleted_users", "_do_purge_users", "retention.purge_users"),
    ("purge_old_notifications", "_do_purge_notifications", "retention.purge_notifications"),
    ("purge_old_audit", "_do_purge_audit", "retention.purge_audit"),
    ("purge_orphan_media", "_do_purge_orphan_media", "retention.purge_orphan_media"),
    ("purge_read_chat_messages", "_do_purge_read_messages", "retention.purge_read_messages"),
]


@pytest.mark.parametrize(("wrapper", "impl", "task_name"), _WRAPPERS)
def test_task_wrapper_runs_its_impl(
    monkeypatch: pytest.MonkeyPatch,
    wrapper: str,
    impl: str,
    task_name: str,
) -> None:
    """Every wrapper is `bind=True` and returns the impl's dict verbatim."""

    async def fake() -> dict[str, int]:
        return {"purged": 42}

    monkeypatch.setattr(retention, impl, fake)
    task = getattr(retention, wrapper)

    assert task.apply().get() == {"purged": 42}
    assert task.name == task_name
