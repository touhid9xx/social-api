"""RoomSubscription: join/leave/clear idempotency."""

from __future__ import annotations

import pytest

from social_api.realtime.rooms import RoomSubscription

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_join_is_idempotent() -> None:
    rs = RoomSubscription()
    assert await rs.join(room_id=1) is True
    assert await rs.join(room_id=1) is False


@pytest.mark.asyncio
async def test_leave_unknown_false() -> None:
    rs = RoomSubscription()
    assert await rs.leave(room_id=1) is False


@pytest.mark.asyncio
async def test_clear_returns_all() -> None:
    rs = RoomSubscription()
    await rs.join(room_id=1)
    await rs.join(room_id=2)
    cleared = await rs.clear()
    assert cleared == frozenset({1, 2})
    assert await rs.rooms() == frozenset()
