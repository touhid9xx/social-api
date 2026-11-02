"""WebSocket endpoint.

Client connects: /api/v1/ws?token=<jwt-access-token>

Flow:
  1. Rate-limit per IP (10/min).
  2. Validate FF_WS_ENABLED.
  3. Decode + verify JWT; check JTI not blacklisted; verify user exists + active.
  4. accept() upgrade.
  5. Track via ConnectionManager + Redis presence counter.
  6. Spawn two tasks:
     a. Reader loop: client messages (ping, join_room, leave_room), refresh TTL.
     b. Pub/sub loop: user + room channels, push events to client.
  7. On close: cleanup presence, disconnect.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

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
)
from social_api.realtime.events import build_event, parse_event
from social_api.realtime.manager import manager
from social_api.realtime.rooms import RoomSubscription

logger = get_logger(__name__)

router = APIRouter()

HEARTBEAT_INTERVAL_SECONDS = 30
READ_TIMEOUT_SECONDS = 60


def _observe_ws_connect(result: str) -> None:
    try:
        from social_api.observability.metrics import websocket_connect_total

        websocket_connect_total.labels(result=result).inc()
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug(
            "metric_observe_failed",
            metric="websocket_connect_total",
            result=result,
            error=type(exc).__name__,
        )


def _observe_ws_disconnect(reason: str) -> None:
    try:
        from social_api.observability.metrics import websocket_disconnect_total

        websocket_disconnect_total.labels(reason=reason).inc()
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug(
            "metric_observe_failed",
            metric="websocket_disconnect_total",
            reason=reason,
            error=type(exc).__name__,
        )


async def _authenticate_ws(token: str) -> int | None:
    """Verify token AND user existence/active status. Return user_id or None.

    The DB check is required because a valid, unexpired, non-blacklisted
    JWT can still belong to a user who was soft-deleted (is_active=0) or
    hard-deleted by the GDPR purge job. Without this check, a deleted
    user's token could open a WS, receive realtime notifications, and
    register presence_incr — a ghost identity receiving live traffic.
    """
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
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        return None

    # Verify user exists, is active and is verified — mirror
    # get_current_user's checks so the socket cannot outlive the REST gate.
    # One DB read per connect — cost bounded by the 10/min rate limit.
    from social_api.db.session import get_sessionmaker
    from social_api.modules.auth.repository import UserRepository

    sm = get_sessionmaker()
    async with sm() as session:
        user = await UserRepository(session).get_by_id(user_id)
        if user is None or not user.is_active or not user.is_verified:
            return None
    return user_id


async def _reader_loop(
    ws: WebSocket,
    user_id: int,
    pubsub: Any,
    room_subs: RoomSubscription,
) -> None:
    """Read client messages; handle ping, join_room, leave_room.

    NOTE: typing events are broadcast to `ws:room:{rid}` and reach ALL
    subscribers INCLUDING the sender. The frontend is expected to
    ignore `kind=typing` events whose `user_id` matches the local user.
    If the frontend doesn't, the sender will see their own typing
    indicator flash — cosmetic, no privacy issue.
    """
    from social_api.db.session import get_sessionmaker
    from social_api.modules.chat.repository import ChatRepository

    redis = get_redis()
    sm = get_sessionmaker()

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
        if not event:
            continue

        etype = event.get("type")
        if etype == "ping":
            await presence_heartbeat(redis=redis, user_id=user_id)
            await ws.send_text(build_event(type_="pong"))
            continue

        if etype == "join_room":
            data = event.get("data") or {}
            room_id = data.get("room_id")
            if not isinstance(room_id, int):
                await ws.send_text(build_event(type_="error", data={"code": "INVALID_ROOM_ID"}))
                continue

            # Verify membership in a short session.
            ok = False
            async with sm() as session:
                try:
                    member = await ChatRepository(session).get_member(
                        room_id=room_id, user_id=user_id
                    )
                    ok = member is not None
                except Exception:
                    ok = False

            if not ok:
                await ws.send_text(
                    build_event(
                        type_="error",
                        data={"code": "NOT_A_MEMBER", "room_id": room_id},
                    )
                )
                continue

            is_new = await room_subs.join(room_id=room_id)
            if is_new:
                await pubsub.subscribe(f"ws:room:{room_id}")
            await ws.send_text(build_event(type_="joined", data={"room_id": room_id}))
            continue

        if etype == "leave_room":
            data = event.get("data") or {}
            room_id = data.get("room_id")
            if not isinstance(room_id, int):
                continue
            was_member = await room_subs.leave(room_id=room_id)
            if was_member:
                await pubsub.unsubscribe(f"ws:room:{room_id}")
            await ws.send_text(build_event(type_="left", data={"room_id": room_id}))
            continue


async def _pubsub_loop(ws: WebSocket, user_id: int, pubsub: Any) -> None:
    """Receive messages from all subscribed channels; push to client.

    The client receives BOTH `ws:user:{self}` and `ws:room:{rid}` events
    merged on the same socket. The client routes by `type` + `data.kind`.

    TODO(M21): when a moderator removes a member from a room via HTTP,
    the WS subscriber has no way to know — it keeps receiving
    `ws:room:{rid}` events until the socket closes. Publish a `kick`
    event from the moderation service so this loop can auto-unsubscribe.
    """
    try:
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg is None:
                continue
            data = msg.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            if isinstance(data, str):
                await ws.send_text(data)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # pragma: no cover
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
    if not get_flags().is_enabled("ws_enabled"):
        _observe_ws_connect("feature_off")
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    ip = ws.client.host if ws.client else "unknown"
    if not await check_ws_connect_limit(ip=ip):
        _observe_ws_connect("rate_limited")
        await ws.close(code=4029)
        return

    if not token:
        _observe_ws_connect("auth_fail")
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id = await _authenticate_ws(token)
    if user_id is None:
        _observe_ws_connect("auth_fail")
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    _observe_ws_connect("success")

    redis = get_redis()
    await manager.connect(user_id=user_id, ws=ws)
    await presence_incr(redis=redis, user_id=user_id)

    pubsub = redis.pubsub()
    await pubsub.subscribe(f"ws:user:{user_id}")

    room_subs = RoomSubscription()
    disconnect_reason = "unknown"

    reader_task = asyncio.create_task(_reader_loop(ws, user_id, pubsub, room_subs))
    pubsub_task = asyncio.create_task(_pubsub_loop(ws, user_id, pubsub))
    heartbeat_task = asyncio.create_task(_heartbeat_loop(ws, user_id))

    try:
        done, _pending = await asyncio.wait(
            {reader_task, pubsub_task, heartbeat_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        # Classify
        for t in done:
            exc = t.exception() if not t.cancelled() else None
            if t is reader_task:
                disconnect_reason = "timeout" if isinstance(exc, TimeoutError) else "client"
            elif t is pubsub_task:
                disconnect_reason = "error"
            else:
                disconnect_reason = "error"
    except asyncio.CancelledError:
        disconnect_reason = "server_shutdown"
        raise
    finally:
        for t in (reader_task, pubsub_task, heartbeat_task):
            if not t.done():
                t.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t

        joined = await room_subs.clear()
        for rid in joined:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(f"ws:room:{rid}")
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(f"ws:user:{user_id}")
        # redis-py's PubSub.aclose() is not fully typed in current stubs —
        # ignore the no-untyped-call locally; behavior is correct at runtime.
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]  # redis stub gap

        await manager.disconnect(user_id=user_id, ws=ws)
        await presence_decr(redis=redis, user_id=user_id)
        _observe_ws_disconnect(disconnect_reason)
        logger.info("ws_session_closed", user_id=user_id, reason=disconnect_reason)
