"""Feature flag provider: env mapping + swap hook."""

from __future__ import annotations

import pytest

from social_api.config import get_settings
from social_api.core.feature_flags import (
    EnvFeatureFlags,
    get_flags,
    set_flags,
)

pytestmark = pytest.mark.unit


def test_env_flags_read_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FF_WS_ENABLED", "false")
    monkeypatch.setenv("FF_CHAT_ENABLED", "true")
    get_settings.cache_clear()

    flags = EnvFeatureFlags()
    assert flags.is_enabled("ws_enabled") is False
    assert flags.is_enabled("chat_enabled") is True

    get_settings.cache_clear()


def test_unknown_flag_returns_false() -> None:
    flags = EnvFeatureFlags()
    assert flags.is_enabled("nonexistent_flag") is False


def test_set_flags_swaps_provider() -> None:
    class _AlwaysOn:
        def is_enabled(self, flag: str) -> bool:
            return True

    set_flags(_AlwaysOn())
    try:
        assert get_flags().is_enabled("anything") is True
    finally:
        # restore default
        set_flags(EnvFeatureFlags())
