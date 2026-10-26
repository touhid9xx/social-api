"""Redis pub/sub bridge for cross-worker WebSocket delivery.

Each worker subscribes to `ws:user:{id}` for every local connection.
Publishers (any worker) publish to the same channel. The worker that owns
the socket receives and pushes to the client.

Also maintains per-user presence counter with TTL heartbeat.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Final

from redis.asyncio import Redis
from redis.asyncio.client import PubSub

from social_api.cache.keys import RedisKeys
from social_api.logging_config import get_logger

logger = get_logger(__name__)

CHANNEL_PREFIX: Final[str] = "ws:user:"
PRESENCE_TTL_SECONDS: Final[int] = 60


def channel_for(user_id: int) -> str:
    return f"{CHANNEL_PREFIX}{user_id}"


async def publish_to_user(*, redis: Redis, user_id: int, payload: str) -> int:
    """Publish payload to `ws:user:{id}`.

    Returns number of subscribers that received it. 0 means no worker
    holds a socket for this user.
    """
    try:
        return int(await redis.publish(channel_for(user_id), payload))
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "ws_publish_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )
        return 0


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
        # Best-effort cleanup on cancellation / disconnect — failures here
        # are noise (channel already gone, connection torn down, etc.).
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(channel_for(user_id))
        # redis-py's PubSub.aclose() is not fully typed in current stubs —
        # ignore the no-untyped-call locally; behavior is correct at runtime.
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]  # redis stub gap


# ---------------------------------------------------------------------------
# Presence
# ---------------------------------------------------------------------------
async def presence_incr(*, redis: Redis, user_id: int) -> int:
    key = RedisKeys.presence(user_id)
    count = int(await redis.incr(key))
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return count


async def presence_decr(*, redis: Redis, user_id: int) -> int:
    key = RedisKeys.presence(user_id)
    count = int(await redis.decr(key))
    if count <= 0:
        await redis.delete(key)
        return 0
    # Refresh TTL on remaining connections
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return count


async def presence_heartbeat(*, redis: Redis, user_id: int) -> None:
    """Refresh TTL for a live connection (called every ~30s)."""
    key = RedisKeys.presence(user_id)
    await redis.expire(key, PRESENCE_TTL_SECONDS)


async def presence_check(*, redis: Redis, user_id: int) -> int:
    val = await redis.get(RedisKeys.presence(user_id))
    if val is None:
        return 0
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0
