"""Real-time event envelope + helpers.

Every WS frame is JSON: {"type": <EventType>, "data": {...}, "ts": <iso>}.

EventType is the closed set of message types the server may emit. Client
sends only `ping` (→ server replies `pong`) and `typing` (chat, M15+).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Final, Literal

EventType = Literal[
    "ping",
    "pong",
    "notification",
    "unread_count",
    "presence",
    "error",
    "typing",  # reserved for M15 chat typing indicator
]

_VALID_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {"ping", "pong", "notification", "unread_count", "presence", "error", "typing"}
)


def build_event(*, type_: EventType, data: Any = None) -> str:
    """Serialize an event envelope to a JSON string."""
    envelope = {
        "type": type_,
        "data": data if data is not None else {},
        "ts": datetime.now(UTC).isoformat(),
    }
    return json.dumps(envelope, separators=(",", ":"))


def parse_event(raw: str) -> dict[str, Any] | None:
    """Parse a client → server frame. Returns dict or None on failure."""
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    etype = obj.get("type")
    if not isinstance(etype, str) or etype not in _VALID_EVENT_TYPES:
        return None
    return obj
