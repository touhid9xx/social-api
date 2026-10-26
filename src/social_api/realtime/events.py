"""Real-time event envelope + helpers.

Every WS frame is JSON: {"type": <EventType>, "data": {...}, "ts": <iso>}.

EventType is the closed set of message types the server may emit. Client
sends `ping` (server replies `pong`), `join_room` / `leave_room` (server
acknowledges with `joined` / `left`), and `typing` (chat, best-effort).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Final, Literal

EventType = Literal[
    # Health / liveness
    "ping",
    "pong",
    # Notification / unread badge
    "notification",
    "unread_count",
    # Presence
    "presence",
    # Chat
    "typing",
    "joined",
    "left",
    # Errors
    "error",
]

# frozenset mirror of EventType for parse_event() runtime validation.
_VALID_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "ping",
        "pong",
        "notification",
        "unread_count",
        "presence",
        "typing",
        "joined",
        "left",
        "error",
    }
)

# Client → server message types (a subset of EventType). Not enforced at
# the JSON level — ws.py ignores unknown types — but useful documentation
# and for future server-side filtering.
_CLIENT_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {"ping", "join_room", "leave_room", "typing"}
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
