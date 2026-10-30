"""Feature flag providers."""

from __future__ import annotations

from typing import Protocol

from social_api.logging_config import get_logger

logger = get_logger(__name__)


BUILTIN_FLAGS: dict[str, bool] = {
    "ws_enabled": True,
    "chat_enabled": True,
    "gdpr_enabled": True,
    "feed_fanout_enabled": False,
    "email_enabled": True,
    "sms_enabled": False,
}


class FeatureFlagProvider(Protocol):
    async def is_enabled(self, name: str, *, user_id: int | None = None) -> bool: ...


class EnvFeatureFlags:
    """Reads settings.ff_* booleans. Sync API preserved for compat."""

    def is_enabled_sync(self, name: str) -> bool:
        from social_api.config import get_settings

        s = get_settings()
        mapping = {
            "ws_enabled": s.ff_ws_enabled,
            "chat_enabled": s.ff_chat_enabled,
            "gdpr_enabled": s.ff_gdpr_enabled,
            "feed_fanout_enabled": s.ff_feed_fanout_enabled,
            "email_enabled": s.ff_email_enabled,
            "sms_enabled": s.ff_sms_enabled,
        }
        if name in mapping:
            return mapping[name]
        return BUILTIN_FLAGS.get(name, False)


class ChainedFlags:
    """
    Per-user (Redis) → env → builtin.

    Per-user override key: `ff:user:{user_id}:{name}` = "1"|"0".

    Flag checks with `user_id=None` (the common case) skip Redis
    entirely — env vars are cheap and static. Only per-user overrides
    pay a Redis round trip.
    """

    async def is_enabled(self, name: str, *, user_id: int | None = None) -> bool:
        if user_id is not None:
            try:
                from social_api.cache.redis import get_redis, guarded

                redis = get_redis()
                val = await guarded(
                    lambda: redis.get(f"ff:user:{user_id}:{name}"),
                    default=None,
                    op="flag_user_override",
                )
                if val == "1":
                    return True
                if val == "0":
                    return False
            except Exception as exc:  # pragma: no cover — defensive
                # A Redis outage must not break flag evaluation; fall
                # through to env. Log at debug so "why did feature X
                # flip for user Y" is investigable.
                logger.debug(
                    "flag_user_override_failed",
                    name=name,
                    user_id=user_id,
                    error=type(exc).__name__,
                )

        env_provider = EnvFeatureFlags()
        if name in BUILTIN_FLAGS:
            return env_provider.is_enabled_sync(name)
        return BUILTIN_FLAGS.get(name, False)


_flags: FeatureFlagProvider = ChainedFlags()


def get_flags() -> FeatureFlagProvider:
    return _flags


def set_flags(provider: FeatureFlagProvider) -> None:
    global _flags
    _flags = provider


# ---- Admin helpers ----
async def set_user_override(*, user_id: int, name: str, enabled: bool | None) -> None:
    """
    Set or clear a per-user flag override.

    enabled=None -> clear override (fall back to env).
    """
    from social_api.cache.redis import get_redis

    redis = get_redis()
    k = f"ff:user:{user_id}:{name}"
    if enabled is None:
        await redis.delete(k)
    else:
        await redis.set(k, "1" if enabled else "0")


async def count_user_overrides(*, name: str) -> int:
    """Approximate count via SCAN. Bounded by time; use sparingly."""
    from social_api.cache.redis import get_redis

    redis = get_redis()
    pattern = f"ff:user:*:{name}"
    count = 0
    async for _ in redis.scan_iter(match=pattern, count=200):
        count += 1
    return count
