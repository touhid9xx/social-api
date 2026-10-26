"""Notification realtime push helpers + integration into service."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest

from social_api.modules.notifications.models import (
    Notification,
    NotificationTargetType,
    NotificationType,
)
from social_api.modules.notifications.service import NotificationsService

pytestmark = pytest.mark.unit


class _FakeRepo:
    def __init__(self) -> None:
        self._seen: dict[tuple[int, int, str, str, int, date], Notification] = {}
        self._next_id = 1
        self.created: list[Notification] = []

    async def create(
        self,
        *,
        user_id: int,
        actor_id: int,
        type_: str,
        target_type: str,
        target_id: int,
        preview: str | None,
        now: datetime | None = None,
    ) -> Notification | None:
        n = now or datetime.now(UTC).replace(tzinfo=None)
        key = (
            user_id,
            actor_id,
            type_,
            target_type,
            target_id,
            n.date(),
        )
        if key in self._seen:
            return None
        row = Notification(
            id=self._next_id,
            user_id=user_id,
            actor_id=actor_id,
            type=NotificationType(type_),
            target_type=NotificationTargetType(target_type),
            target_id=target_id,
            is_read=False,
            read_at=None,
            day_bucket=n.date(),
            preview=preview,
            created_at=n,
            updated_at=n,
            deleted_at=None,
            version=1,
        )
        self._next_id += 1
        self._seen[key] = row
        self.created.append(row)
        return row


class _FakeFollows:
    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return False


def _svc(repo: _FakeRepo) -> NotificationsService:
    svc = NotificationsService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._follows = _FakeFollows()  # type: ignore[assignment]
    return svc


@pytest.fixture
def captured_pushes(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture push_notification calls without touching Redis."""
    pushes: list[dict[str, Any]] = []

    from social_api.modules.notifications import realtime

    async def _fake_push(*, user_id: int, notification_payload: dict[str, Any]) -> None:
        pushes.append({"user_id": user_id, "payload": notification_payload})

    monkeypatch.setattr(realtime, "push_notification", _fake_push)
    return pushes


@pytest.mark.asyncio
async def test_publish_on_notify_follow(
    captured_pushes: list[dict[str, Any]],
) -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_follow(follower_id=10, followee_id=20)

    assert len(captured_pushes) == 1
    p = captured_pushes[0]
    assert p["user_id"] == 20
    assert p["payload"]["type"] == "follow"
    assert p["payload"]["actor_id"] == 10
    assert p["payload"]["target_id"] == 10


@pytest.mark.asyncio
async def test_no_publish_on_self_follow(
    captured_pushes: list[dict[str, Any]],
) -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_follow(follower_id=10, followee_id=10)
    assert captured_pushes == []


@pytest.mark.asyncio
async def test_no_double_publish_on_duplicate(
    captured_pushes: list[dict[str, Any]],
) -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    await svc.notify_like(liker_id=10, target_author_id=20, target_type="post", target_id=100)
    await svc.notify_like(liker_id=10, target_author_id=20, target_type="post", target_id=100)
    # Second call is idempotent (repo returns None) -> no push
    assert len(captured_pushes) == 1


@pytest.mark.asyncio
async def test_push_payload_is_json_serializable(
    captured_pushes: list[dict[str, Any]],
) -> None:
    import json

    repo = _FakeRepo()
    await _svc(repo).notify_comment(
        commenter_id=10,
        post_author_id=20,
        post_id=100,
        parent_author_id=None,
        parent_comment_id=None,
        excerpt="hello",
    )
    # Payload must survive json.dumps without custom encoder
    json.dumps(captured_pushes[0]["payload"])
