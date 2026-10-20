"""Redis client factory (used from M3)."""

from __future__ import annotations

from redis.asyncio import Redis, from_url

from social_api.config import get_settings

_client: Redis | None = None


def get_redis() -> Redis:
    """Return the process-wide async Redis client (lazily initialised)."""
    global _client
    if _client is None:
        settings = get_settings()
        # redis-py's async `from_url` is untyped in some overloads (third-party gap).
        # We return `Redis` explicitly, so the runtime contract is still guaranteed.
        _client = from_url(  # type: ignore[no-untyped-call]
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _client


async def close_redis() -> None:
    """Close the shared Redis connection (call from lifespan shutdown)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
