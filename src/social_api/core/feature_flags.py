"""Env-backed feature flag provider (Unleash-ready interface)."""

from __future__ import annotations

from typing import Protocol

from social_api.config import get_settings


class FeatureFlagProvider(Protocol):
    def is_enabled(self, flag: str) -> bool: ...


class EnvFeatureFlags:
    """Reads settings.ff_* booleans."""

    def is_enabled(self, flag: str) -> bool:
        s = get_settings()
        mapping = {
            "ws_enabled": s.ff_ws_enabled,
            "chat_enabled": s.ff_chat_enabled,
            "gdpr_enabled": s.ff_gdpr_enabled,
            "feed_fanout_enabled": s.ff_feed_fanout_enabled,
            "email_enabled": s.ff_email_enabled,
            "sms_enabled": s.ff_sms_enabled,
        }
        return mapping.get(flag, False)


_flags: FeatureFlagProvider = EnvFeatureFlags()


def get_flags() -> FeatureFlagProvider:
    return _flags


def set_flags(provider: FeatureFlagProvider) -> None:
    """Test hook: swap the provider."""
    global _flags
    _flags = provider
