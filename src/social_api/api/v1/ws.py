"""WebSocket endpoint.

Client connects: /api/v1/ws?token=<jwt-access-token>

Flow:
  1. Rate-limit per IP (10/min).
  2. Validate FF_WS_ENABLED.
  3. Decode + verify JWT; check JTI not blacklisted.
  4. accept() upgrade.
  5. Track via ConnectionManager + Redis presence counter.
  6. Spawn two tasks:
     a. Reader loop: client messages (ping, etc.), refresh TTL.
     b. Pub/sub loop: subscribe to `ws:user:{id}`, push events to client.
  7. On close: cleanup presence, disconnect.
"""

from __future__ import annotations

import asyncio
import contextlib

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from social_api.cache.redis import get_redis
from social_api.core.feature_flags import get_flags
from social_api.core.rate_limit import check_ws_connect_limit
from social_api.core.security import ACCESS, decode_token, is_blacklisted
from social_api.logging_config import get_logger
from social_api.realtime.channels import (
    presence_decr,
    presence_heartbeat,
    presence_incr,
    subscribe_user,
)
from social_api.realtime.events import build_event, parse_event
from social_api.realtime.manager import manager

logger = get_logger(__name__)

router = APIRouter()

HEARTBEAT_INTERVAL_SECONDS = 30
READ_TIMEOUT_SECONDS = 60


async def _authenticate_ws(token: str) -> int | None:
    """Return user_id or None."""
    try:
        payload = decode_token(token, expected_type=ACCESS)
    except jwt.PyJWTError:
        return None
    jti = payload.get("jti")
    if not jti:
        return None
    if await is_blacklisted(jti):
        return None
    try:
        return int(payload["sub"])
    except (KeyError, ValueError):
        return None


async def _reader_loop(ws: WebSocket, user_id: int) -> None:
    """Read client messages; respond to ping; refresh presence TTL."""
    redis = get_redis()
    while True:
        try:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=READ_TIMEOUT_SECONDS)
        except TimeoutError:
            logger.info("ws_read_timeout", user_id=user_id)
            with contextlib.suppress(Exception):
                await ws.close(code=status.WS_1001_GOING_AWAY)
            return
        except WebSocketDisconnect:
            return

        event = parse_event(raw)
        if event and event.get("type") == "ping":
            await presence_heartbeat(redis=redis, user_id=user_id)
            await ws.send_text(build_event(type_="pong"))


async def _pubsub_loop(ws: WebSocket, user_id: int) -> None:
    """Subscribe to this user's Redis channel; push to client."""
    redis = get_redis()
    try:
        async for message in subscribe_user(redis=redis, user_id=user_id):
            await ws.send_text(message)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "ws_pubsub_loop_error",
            user_id=user_id,
            error=type(exc).__name__,
        )


async def _heartbeat_loop(ws: WebSocket, user_id: int) -> None:
    """Server sends ping every 30s; keeps presence TTL alive."""
    redis = get_redis()
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
            await ws.send_text(build_event(type_="ping"))
            await presence_heartbeat(redis=redis, user_id=user_id)
    except (WebSocketDisconnect, RuntimeError):
        return


@router.websocket("/ws")
async def ws_endpoint(
    ws: WebSocket,
    token: str | None = Query(default=None),
) -> None:
    # 1) Feature flag
    if not get_flags().is_enabled("ws_enabled"):
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 2) Rate limit
    ip = ws.client.host if ws.client else "unknown"
    if not await check_ws_connect_limit(ip=ip):
        await ws.close(code=4029)  # custom policy-violation-close
        return

    # 3) Auth
    if not token:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id = await _authenticate_ws(token)
    if user_id is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 4) Accept + track
    await ws.accept()
    redis = get_redis()
    await manager.connect(user_id=user_id, ws=ws)
    await presence_incr(redis=redis, user_id=user_id)

    reader_task = asyncio.create_task(_reader_loop(ws, user_id))
    pubsub_task = asyncio.create_task(_pubsub_loop(ws, user_id))
    heartbeat_task = asyncio.create_task(_heartbeat_loop(ws, user_id))

    try:
        await asyncio.wait(
            {reader_task, pubsub_task, heartbeat_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
    finally:
        for t in (reader_task, pubsub_task, heartbeat_task):
            if not t.done():
                t.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t
        await manager.disconnect(user_id=user_id, ws=ws)
        await presence_decr(redis=redis, user_id=user_id)
        logger.info("ws_session_closed", user_id=user_id)
