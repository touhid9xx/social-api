"""ConnectionManager: add / remove / send."""

from __future__ import annotations

import pytest

from social_api.realtime.manager import ConnectionManager

pytestmark = pytest.mark.unit


class _FakeWS:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.closed = False
        self._fail = False

    async def send_text(self, payload: str) -> None:
        if self._fail:
            raise RuntimeError("socket dead")
        self.sent.append(payload)

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_connect_disconnect() -> None:
    m = ConnectionManager()
    ws = _FakeWS()
    await m.connect(user_id=1, ws=ws)  # type: ignore[arg-type]
    assert await m.is_connected(user_id=1)
    assert await m.local_connection_count() == 1
    await m.disconnect(user_id=1, ws=ws)  # type: ignore[arg-type]
    assert not await m.is_connected(user_id=1)
    assert await m.local_connection_count() == 0


@pytest.mark.asyncio
async def test_multiple_sockets_per_user() -> None:
    m = ConnectionManager()
    ws1 = _FakeWS()
    ws2 = _FakeWS()
    await m.connect(user_id=1, ws=ws1)  # type: ignore[arg-type]
    await m.connect(user_id=1, ws=ws2)  # type: ignore[arg-type]

    n = await m.send_to_user(user_id=1, payload="hello")
    assert n == 2
    assert ws1.sent == ["hello"]
    assert ws2.sent == ["hello"]


@pytest.mark.asyncio
async def test_send_to_absent_user() -> None:
    m = ConnectionManager()
    n = await m.send_to_user(user_id=999, payload="x")
    assert n == 0


@pytest.mark.asyncio
async def test_dead_socket_pruned() -> None:
    m = ConnectionManager()
    ws = _FakeWS()
    ws._fail = True
    await m.connect(user_id=1, ws=ws)  # type: ignore[arg-type]
    n = await m.send_to_user(user_id=1, payload="x")
    assert n == 0
    # Pruned -> not connected anymore
    assert not await m.is_connected(user_id=1)


@pytest.mark.asyncio
async def test_close_all() -> None:
    m = ConnectionManager()
    ws1 = _FakeWS()
    ws2 = _FakeWS()
    await m.connect(user_id=1, ws=ws1)  # type: ignore[arg-type]
    await m.connect(user_id=2, ws=ws2)  # type: ignore[arg-type]
    await m.close_all()
    # PT018: split assertions so a failure names the socket that didn't close.
    assert ws1.closed
    assert ws2.closed
    assert await m.local_connection_count() == 0
