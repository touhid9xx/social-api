"""Async Redis client factory + lifespan hooks + health probe + breaker-guarded helper."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Final, TypeVar

from redis.asyncio import Redis, from_url

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

_client: Redis | None = None
_REDIS_PING_TIMEOUT_SECONDS: Final[float] = 3.0
T = TypeVar("T")


def init_redis() -> Redis:
    global _client
    if _client is not None:
        return _client
    settings = get_settings()
    # redis-py's from_url is untyped in current stubs — the returned object
    # is a Redis client regardless. Ignore the no-untyped-call; the runtime
    # shape is correct and every downstream use is typed through `Redis`.
    _client = from_url(  # type: ignore[no-untyped-call]  # redis stub gap
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
    start = time.perf_counter()
    try:
        client = get_redis()
        pong = await client.ping()
        elapsed_ms = (time.perf_counter() - start) * 1000
        if pong is True:
            return True, round(elapsed_ms, 2), None
        return False, round(elapsed_ms, 2), f"unexpected_ping_response:{pong!r}"
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.debug("redis_ping_failed", error_type=type(exc).__name__)
        return False, round(elapsed_ms, 2), type(exc).__name__


async def guarded(  # noqa: UP047 — PEP 695 generics change runtime semantics; TypeVar is safer for mypy strict
    fn: Callable[[], Awaitable[T]],
    *,
    default: T,
    op: str,
) -> T:
    from social_api.core.circuit_breakers import (
        BreakerOpenError,
        redis_breaker,
    )

    try:
        return await redis_breaker.call(fn)
    except BreakerOpenError:
        logger.debug("redis_breaker_open", op=op)
        return default
    except Exception as exc:
        logger.warning("redis_guarded_failed", op=op, error=type(exc).__name__)
        return default
