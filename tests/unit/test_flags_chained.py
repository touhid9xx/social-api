"""ChainedFlags per-user override."""

from __future__ import annotations

import pytest

from social_api.core.flags.provider import (
    BUILTIN_FLAGS,
    ChainedFlags,
)

pytestmark = pytest.mark.unit


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)


@pytest.mark.asyncio
async def test_env_default_when_no_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from social_api.cache import redis as redis_mod

    monkeypatch.setattr(redis_mod, "_client", _FakeRedis(), raising=False)

    flags = ChainedFlags()
    # feed_fanout_enabled default False
    v = await flags.is_enabled("feed_fanout_enabled")
    assert v is False
    # ws_enabled default True
    v = await flags.is_enabled("ws_enabled")
    assert v is True


@pytest.mark.asyncio
async def test_user_override_on(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.store["ff:user:42:feed_fanout_enabled"] = "1"
    from social_api.cache import redis as redis_mod

    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)

    flags = ChainedFlags()
    assert await flags.is_enabled("feed_fanout_enabled", user_id=42) is True


@pytest.mark.asyncio
async def test_user_override_off(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.store["ff:user:42:ws_enabled"] = "0"
    from social_api.cache import redis as redis_mod

    monkeypatch.setattr(redis_mod, "_client", fake, raising=False)

    flags = ChainedFlags()
    assert await flags.is_enabled("ws_enabled", user_id=42) is False


@pytest.mark.asyncio
async def test_unknown_flag_returns_builtin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from social_api.cache import redis as redis_mod

    monkeypatch.setattr(redis_mod, "_client", _FakeRedis(), raising=False)

    flags = ChainedFlags()
    assert await flags.is_enabled("some_unknown_flag") is False


def test_builtin_flags_present() -> None:
    for name in (
        "ws_enabled",
        "chat_enabled",
        "gdpr_enabled",
        "feed_fanout_enabled",
    ):
        assert name in BUILTIN_FLAGS
