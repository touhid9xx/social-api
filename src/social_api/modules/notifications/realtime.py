"""WS push helpers for notifications.

Publish is best-effort: WS down / Redis down / no subscribers = silent.
The notification row is authoritative; WS is a delivery optimisation.

Feature-flagged behind FF_WS_ENABLED (same flag gates the /ws endpoint).
"""

from __future__ import annotations

from typing import Any

from social_api.cache.redis import get_redis
from social_api.core.feature_flags import get_flags
from social_api.logging_config import get_logger
from social_api.realtime.channels import publish_to_user
from social_api.realtime.events import build_event

logger = get_logger(__name__)


async def push_notification(*, user_id: int, notification_payload: dict[str, Any]) -> None:
    """Push a new-notification event. Includes unread_delta=+1 hint."""
    if not get_flags().is_enabled("ws_enabled"):
        return
    try:
        redis = get_redis()
        payload = {
            **notification_payload,
            "unread_delta": 1,
        }
        subscribers = await publish_to_user(
            redis=redis,
            user_id=user_id,
            payload=build_event(type_="notification", data=payload),
        )
        logger.debug(
            "ws_push_notification",
            user_id=user_id,
            subscribers=subscribers,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "ws_push_notification_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )


async def push_unread_delta(*, user_id: int, delta: int) -> None:
    """Push a delta adjustment for the unread badge (e.g. -1 after mark-read)."""
    if not get_flags().is_enabled("ws_enabled"):
        return
    try:
        redis = get_redis()
        await publish_to_user(
            redis=redis,
            user_id=user_id,
            payload=build_event(type_="unread_count", data={"unread_delta": delta}),
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "ws_push_unread_delta_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )


async def push_unread_reset(*, user_id: int) -> None:
    """Push authoritative unread=0 (after mark_all_read)."""
    if not get_flags().is_enabled("ws_enabled"):
        return
    try:
        redis = get_redis()
        await publish_to_user(
            redis=redis,
            user_id=user_id,
            payload=build_event(type_="unread_count", data={"unread": 0}),
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning(
            "ws_push_unread_reset_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )
