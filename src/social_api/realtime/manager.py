"""In-process WebSocket connection manager.

Tracks user_id -> set[WebSocket]. One instance per worker process.
Cross-worker delivery is handled by realtime.channels (Redis pub/sub).
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict

from fastapi import WebSocket

from social_api.logging_config import get_logger

logger = get_logger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, *, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[user_id].add(ws)
            count = len(self._conns[user_id])
        logger.info("ws_connected", user_id=user_id, connections=count)

    async def disconnect(self, *, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._conns.get(user_id)
            if conns is None:
                return
            conns.discard(ws)
            count = len(conns)
            if count == 0:
                self._conns.pop(user_id, None)
        logger.info("ws_disconnected", user_id=user_id, connections=count)

    async def send_to_user(self, *, user_id: int, payload: str) -> int:
        """Send text payload to every socket this worker holds for user_id.

        Returns number of sockets written. Sockets that fail are pruned
        (assumed closed) — the heartbeat/disconnect path cleans the rest.
        """
        async with self._lock:
            conns = list(self._conns.get(user_id, ()))
        if not conns:
            return 0
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                bucket = self._conns.get(user_id)
                if bucket is not None:
                    for ws in dead:
                        bucket.discard(ws)
                    if not bucket:
                        self._conns.pop(user_id, None)
        return len(conns) - len(dead)

    async def is_connected(self, *, user_id: int) -> bool:
        async with self._lock:
            return bool(self._conns.get(user_id))

    async def local_connection_count(self) -> int:
        async with self._lock:
            return sum(len(s) for s in self._conns.values())

    async def close_all(self) -> None:
        """Called from lifespan shutdown."""
        async with self._lock:
            all_ws = [ws for s in self._conns.values() for ws in s]
            self._conns.clear()
        for ws in all_ws:
            # Best-effort — one dead socket must not stop the rest.
            with contextlib.suppress(Exception):
                await ws.close()


# Singleton — one per process
manager = ConnectionManager()
