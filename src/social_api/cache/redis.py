"""Async Redis client factory + lifespan hooks + health probe."""

from __future__ import annotations

import time
from typing import Final

from redis.asyncio import Redis, from_url

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

_client: Redis | None = None

_REDIS_PING_TIMEOUT_SECONDS: Final[float] = 3.0


def init_redis() -> Redis:
    """Create the global async Redis client (idempotent). Called from lifespan."""
    global _client
    if _client is not None:
        return _client
    settings = get_settings()
    _client = from_url(  # type: ignore[no-untyped-call]
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=_REDIS_PING_TIMEOUT_SECONDS,
        socket_timeout=_REDIS_PING_TIMEOUT_SECONDS,
        health_check_interval=30,
    )
    logger.info("redis_initialized")
    return _client


async def close_redis() -> None:
    """Close the client. Called from lifespan shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        logger.info("redis_closed")
    _client = None


def get_redis() -> Redis:
    if _client is None:
        return init_redis()
    return _client


async def ping_redis() -> tuple[bool, float, str | None]:
    """
    Readiness probe: Redis PING.

    Returns (ok, latency_ms, error_message).
    Never raises.
    """
    start = time.perf_counter()
    try:
        client = get_redis()
        # redis-py asyncio client handles its own timeouts via socket_timeout
        pong = await client.ping()
        elapsed_ms = (time.perf_counter() - start) * 1000
        if pong is True:
            return True, round(elapsed_ms, 2), None
        return False, round(elapsed_ms, 2), f"unexpected_ping_response:{pong!r}"
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.debug("redis_ping_failed", error_type=type(exc).__name__)
        return False, round(elapsed_ms, 2), type(exc).__name__
