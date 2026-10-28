"""Idempotency service state machine."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from social_api.modules.idempotency.exceptions import (
    IdempotencyConflictError,
    IdempotencyInProgressError,
)
from social_api.modules.idempotency.models import IdempotencyKey
from social_api.modules.idempotency.service import (
    IdempotencyService,
    hash_body,
    raise_if_blocked,
)

pytestmark = pytest.mark.unit


class _FakeRepo:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, int], IdempotencyKey] = {}
        self._next_id = 1

    async def get(self, *, key: str, user_id: int) -> IdempotencyKey | None:
        return self.rows.get((key, user_id))

    async def try_insert(
        self,
        *,
        key: str,
        user_id: int,
        endpoint: str,
        method: str,
        request_hash: str,
        expires_at: datetime,
    ) -> IdempotencyKey | None:
        if (key, user_id) in self.rows:
            return None
        row = IdempotencyKey(
            id=self._next_id,
            key=key,
            user_id=user_id,
            endpoint=endpoint,
            method=method,
            request_hash=request_hash,
            response_status=None,
            response_body=None,
            created_at=datetime.now(UTC).replace(tzinfo=None),
            expires_at=expires_at,
        )
        self._next_id += 1
        self.rows[(key, user_id)] = row
        return row

    async def complete(self, *, row_id: int, status: int, body: dict[str, Any] | None) -> None:
        for row in self.rows.values():
            if row.id == row_id:
                row.response_status = status
                row.response_body = body
                return

    async def delete_by_id(self, row_id: int) -> None:
        for k, row in list(self.rows.items()):
            if row.id == row_id:
                del self.rows[k]
                return


def _svc(repo: _FakeRepo) -> IdempotencyService:
    svc = IdempotencyService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_first_request_miss_and_record() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    state, body, status = await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"body":"hi"}'),
    )
    assert state == "miss"
    assert body is None
    assert status is None

    await svc.record_response(key="abc12345", user_id=1, status=201, body={"id": 42})

    state2, body2, status2 = await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"body":"hi"}'),
    )
    assert state2 == "hit"
    assert body2 == {"id": 42}
    assert status2 == 201


@pytest.mark.asyncio
async def test_conflict_on_different_body() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"body":"hi"}'),
    )
    state, _, _ = await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"body":"different"}'),
    )
    assert state == "conflict"


@pytest.mark.asyncio
async def test_in_progress_when_not_yet_completed() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"x":1}'),
    )
    state, _, _ = await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"x":1}'),
    )
    assert state == "in_progress"


@pytest.mark.asyncio
async def test_different_user_same_key_independent() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"x":1}'),
    )
    state, _, _ = await svc.check_or_reserve(
        key="abc12345",
        user_id=2,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b'{"x":1}'),
    )
    assert state == "miss"


@pytest.mark.asyncio
async def test_expired_row_cleaned_and_reinserted() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    # Manually plant expired row
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    repo.rows[("abc12345", 1)] = IdempotencyKey(
        id=99,
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b"old"),
        response_status=201,
        response_body={"id": 1},
        created_at=past,
        expires_at=past,
    )
    state, _, _ = await svc.check_or_reserve(
        key="abc12345",
        user_id=1,
        endpoint="/api/v1/posts",
        method="POST",
        request_hash=hash_body(b"old"),
    )
    assert state == "miss"


def test_raise_if_blocked() -> None:
    with pytest.raises(IdempotencyConflictError):
        raise_if_blocked("conflict")
    with pytest.raises(IdempotencyInProgressError):
        raise_if_blocked("in_progress")
    raise_if_blocked("miss")  # no exception
    raise_if_blocked("hit")
