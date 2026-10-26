"""Notifications service: idempotency, self-guard, block-guard."""

from __future__ import annotations

from datetime import UTC, date, datetime

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
        # Dedupe key: user_id, actor_id, type, target_type, target_id, day_bucket
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
        key: tuple[int, int, str, str, int, date] = (
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
    def __init__(self, blocked: set[tuple[int, int]] | None = None) -> None:
        self._blocked = blocked or set()

    async def blocked_either_direction(self, a: int, b: int) -> bool:
        return (a, b) in self._blocked or (b, a) in self._blocked


def _svc(repo: _FakeRepo, follows: _FakeFollows | None = None) -> NotificationsService:
    svc = NotificationsService(session=None)  # type: ignore[arg-type]
    svc._repo = repo  # type: ignore[assignment]
    svc._follows = follows or _FakeFollows()  # type: ignore[assignment]
    return svc


@pytest.mark.asyncio
async def test_notify_follow_creates() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_follow(follower_id=10, followee_id=20)
    assert len(repo.created) == 1
    n = repo.created[0]
    assert n.user_id == 20
    assert n.actor_id == 10
    assert n.type == NotificationType.FOLLOW


@pytest.mark.asyncio
async def test_notify_follow_skips_self() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_follow(follower_id=10, followee_id=10)
    assert repo.created == []


@pytest.mark.asyncio
async def test_notify_follow_skips_when_blocked() -> None:
    repo = _FakeRepo()
    follows = _FakeFollows(blocked={(10, 20)})
    await _svc(repo, follows).notify_follow(follower_id=10, followee_id=20)
    assert repo.created == []


@pytest.mark.asyncio
async def test_notify_like_post() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_like(
        liker_id=10,
        target_author_id=20,
        target_type="post",
        target_id=100,
    )
    assert len(repo.created) == 1
    assert repo.created[0].type == NotificationType.LIKE_POST
    assert repo.created[0].target_id == 100


@pytest.mark.asyncio
async def test_notify_like_comment() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_like(
        liker_id=10,
        target_author_id=20,
        target_type="comment",
        target_id=555,
    )
    assert repo.created[0].type == NotificationType.LIKE_COMMENT


@pytest.mark.asyncio
async def test_idempotent_same_day() -> None:
    repo = _FakeRepo()
    svc = _svc(repo)
    await svc.notify_like(liker_id=10, target_author_id=20, target_type="post", target_id=100)
    await svc.notify_like(liker_id=10, target_author_id=20, target_type="post", target_id=100)
    # Only one row despite double trigger
    assert len(repo.created) == 1


@pytest.mark.asyncio
async def test_notify_comment_top_level() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_comment(
        commenter_id=10,
        post_author_id=20,
        post_id=100,
        parent_author_id=None,
        parent_comment_id=None,
        excerpt="nice",
    )
    assert repo.created[0].type == NotificationType.COMMENT_POST
    assert repo.created[0].target_id == 100


@pytest.mark.asyncio
async def test_notify_comment_reply() -> None:
    repo = _FakeRepo()
    await _svc(repo).notify_comment(
        commenter_id=10,
        post_author_id=20,
        post_id=100,
        parent_author_id=30,
        parent_comment_id=555,
        excerpt="reply text",
    )
    assert repo.created[0].type == NotificationType.COMMENT_REPLY
    assert repo.created[0].user_id == 30
    assert repo.created[0].target_id == 555
