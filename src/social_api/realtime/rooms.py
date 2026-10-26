"""Per-socket room subscriptions.

Tracks which ws:room:{id} channels a socket's pubsub has subscribed to,
so join/leave is idempotent and disconnect cleans up.
"""

from __future__ import annotations

import asyncio

from social_api.logging_config import get_logger

logger = get_logger(__name__)


class RoomSubscription:
    """
    Tracks per-socket room membership on the pubsub.

    The `pubsub` object is created in the WS handler (M13 pubsub_loop).
    This helper wraps subscribe/unsubscribe with an in-memory set for
    idempotency.
    """

    def __init__(self) -> None:
        self._rooms: set[int] = set()
        self._lock = asyncio.Lock()

    async def join(self, *, room_id: int) -> bool:
        """Returns True if newly joined, False if already."""
        async with self._lock:
            if room_id in self._rooms:
                return False
            self._rooms.add(room_id)
            return True

    async def leave(self, *, room_id: int) -> bool:
        async with self._lock:
            if room_id not in self._rooms:
                return False
            self._rooms.discard(room_id)
            return True

    async def rooms(self) -> frozenset[int]:
        async with self._lock:
            return frozenset(self._rooms)

    async def clear(self) -> frozenset[int]:
        async with self._lock:
            snapshot = frozenset(self._rooms)
            self._rooms.clear()
            return snapshot
