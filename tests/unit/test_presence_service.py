"""Presence service reads Redis counter."""

from __future__ import annotations

import pytest

from social_api.cache import redis as redis_mod
from social_api.modules.presence.service import PresenceService

pytestmark = pytest.mark.unit


class _FakeRedis:
    def __init__(self, store: dict[str, str] | None = None) -> None:
        self.store = store or {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)


@pytest.mark.asyncio
async def test_presence_offline_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)

    out = await PresenceService().get(user_id=42)
    assert out.online is False
    assert out.connections == 0


@pytest.mark.asyncio
async def test_presence_online(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis({"presence:user:42": "2"})
    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)

    out = await PresenceService().get(user_id=42)
    assert out.online is True
    assert out.connections == 2


@pytest.mark.asyncio
async def test_presence_corrupt_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeRedis({"presence:user:42": "not-an-int"})
    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)

    out = await PresenceService().get(user_id=42)
    assert out.online is False
    assert out.connections == 0
