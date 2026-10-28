"""Redis pub/sub bridge for cross-worker WebSocket delivery.

Each worker subscribes to `ws:user:{id}` for every local connection.
Publishers (any worker) publish to the same channel. The worker that owns
the socket receives and pushes to the client.

Also maintains per-user presence counter with TTL heartbeat.

Presence helpers go through `guarded()` so a Redis outage trips
redis_breaker and presence reads degrade to "offline" (0) instead of 500.
Presence is best-effort; a wrong online/offline state is acceptable.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Final

from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from social_api.cache.keys import RedisKeys
from social_api.core.tracing_helpers import span
from social_api.logging_config import get_logger

logger = get_logger(__name__)

CHANNEL_PREFIX: Final[str] = "ws:user:"
PRESENCE_TTL_SECONDS: Final[int] = 60


def channel_for(user_id: int) -> str:
    return f"{CHANNEL_PREFIX}{user_id}"


async def publish_to_user(*, redis: Redis, user_id: int, payload: str) -> int:
    """Publish to `ws:user:{id}` under the Redis circuit breaker.

    Returns the number of workers that had a live subscriber (0 = no
    socket held by any worker). Fast-fails during a Redis outage — the
    breaker trips after a few socket timeouts, subsequent calls return
    0 in ~0 ms, and the notification row remains authoritative.
    """
    from social_api.cache.redis import guarded

    return await guarded(
        lambda: _do_publish(redis, user_id, payload),
        default=0,
        op="ws_publish",
    )


async def _do_publish(redis: Redis, user_id: int, payload: str) -> int:
    """Inner call executed inside guarded()'s breaker.

    Span wraps the actual Redis publish so Jaeger shows the delivery
    window (channel resolution + PUBLISH round-trip). Attribute values
    are OTel-safe (int/str) by construction.

    TODO(M21): add `subscribers` attribute after publish — requires
    tracing_helper.span() to yield the OTel span instead of None.
    """
    with span("ws.publish", {"user_id": user_id, "size": len(payload)}):
        return int(await redis.publish(channel_for(user_id), payload))


async def subscribe_user(*, redis: Redis, user_id: int) -> AsyncIterator[str]:
    """Async generator yielding messages published to `ws:user:{id}`.

    Caller MUST aclose() the underlying PubSub when the socket closes.
    We expose the PubSub on return so caller can manage lifecycle.
    """
    pubsub: PubSub = redis.pubsub()
    await pubsub.subscribe(channel_for(user_id))
    try:
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            data = msg.get("data")
            if isinstance(data, str):
                yield data
            elif isinstance(data, bytes):
                yield data.decode("utf-8")
    finally:
        # Best-effort cleanup on cancellation / disconnect — failures
        # here are noise (channel already gone, connection torn down).
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(channel_for(user_id))
        # redis-py's PubSub.aclose() is not fully typed in current stubs —
        # ignore the no-untyped-call locally; behavior is correct at runtime.
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]  # redis stub gap


# ---------------------------------------------------------------------------
# Presence — inner _do_* implementations guarded by redis_breaker
# ---------------------------------------------------------------------------
async def _do_presence_incr(redis: Redis, user_id: int) -> int:
    key = RedisKeys.presence(user_id)
    count = int(await redis.incr(key))
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return count


async def _do_presence_decr(redis: Redis, user_id: int) -> int:
    key = RedisKeys.presence(user_id)
    count = int(await redis.decr(key))
    if count <= 0:
        await redis.delete(key)
        return 0
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return count


async def _do_presence_heartbeat(redis: Redis, user_id: int) -> int:
    key = RedisKeys.presence(user_id)
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return 1


async def _do_presence_check(redis: Redis, user_id: int) -> int:
    val = await redis.get(RedisKeys.presence(user_id))
    if val is None:
        return 0
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


async def presence_incr(*, redis: Redis, user_id: int) -> int:
    from social_api.cache.redis import guarded

    return await guarded(
        lambda: _do_presence_incr(redis, user_id),
        default=0,
        op="presence_incr",
    )


async def presence_decr(*, redis: Redis, user_id: int) -> int:
    from social_api.cache.redis import guarded

    return await guarded(
        lambda: _do_presence_decr(redis, user_id),
        default=0,
        op="presence_decr",
    )


async def presence_heartbeat(*, redis: Redis, user_id: int) -> None:
    """Refresh TTL for a live connection (called every ~30s)."""
    from social_api.cache.redis import guarded

    await guarded(
        lambda: _do_presence_heartbeat(redis, user_id),
        default=0,
        op="presence_heartbeat",
    )


async def presence_check(*, redis: Redis, user_id: int) -> int:
    from social_api.cache.redis import guarded

    return await guarded(
        lambda: _do_presence_check(redis, user_id),
        default=0,
        op="presence_check",
    )
