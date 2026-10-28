"""In-process WebSocket connection manager."""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict

from fastapi import WebSocket

from social_api.logging_config import get_logger

logger = get_logger(__name__)


def _set_active_gauge(total: int) -> None:
    """Best-effort metric emission; never fatal."""
    try:
        from social_api.observability.metrics import (
            websocket_connections_active,
        )

        websocket_connections_active.set(total)
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug(
            "metric_observe_failed",
            metric="websocket_connections_active",
            error=type(exc).__name__,
        )


# TODO(M21): remove _singleton_conns; keep a single source of truth in
# manager._conns and compute the gauge lazily. The mirror is currently
# kept in sync manually by every mutating method — a latent drift bug.
_singleton_conns: dict[int, set[WebSocket]] = defaultdict(set)


def _ws_active_gauge() -> None:
    """Push the local count to Prometheus, derived from the singleton mirror."""
    _set_active_gauge(sum(len(s) for s in _singleton_conns.values()))


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, *, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[user_id].add(ws)
            count = len(self._conns[user_id])
            _singleton_conns[user_id].add(ws)
            total = sum(len(s) for s in self._conns.values())

        _set_active_gauge(total)
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
            _singleton_conns.get(user_id, set()).discard(ws)
            total = sum(len(s) for s in self._conns.values())

        _set_active_gauge(total)
        logger.info("ws_disconnected", user_id=user_id, connections=count)

    async def send_to_user(self, *, user_id: int, payload: str) -> int:
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
                # ALSO update the singleton mirror — otherwise _ws_active_gauge()
                # reports a stale over-count after any send-to-dead-socket cycle.
                singleton = _singleton_conns.get(user_id)
                if singleton is not None:
                    for ws in dead:
                        singleton.discard(ws)
                    if not singleton:
                        _singleton_conns.pop(user_id, None)
                total = sum(len(s) for s in self._conns.values())
            _set_active_gauge(total)

        return len(conns) - len(dead)

    async def is_connected(self, *, user_id: int) -> bool:
        async with self._lock:
            return bool(self._conns.get(user_id))

    async def local_connection_count(self) -> int:
        async with self._lock:
            return sum(len(s) for s in self._conns.values())

    async def close_all(self) -> None:
        async with self._lock:
            all_ws = [ws for s in self._conns.values() for ws in s]
            self._conns.clear()
            _singleton_conns.clear()
        for ws in all_ws:
            with contextlib.suppress(Exception):
                await ws.close()
        _set_active_gauge(0)


# Singleton — one per process
manager = ConnectionManager()
