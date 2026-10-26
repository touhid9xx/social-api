"""WebSocket event envelope (shared by server + client).

Kept tiny: {type: "ping"|"pong"|"notification"|..., data: {...}}
M14 will use "notification"; M13 emits "pong" on ping.
"""

from __future__ import annotations

import json
from typing import Any, Literal

EventType = Literal["ping", "pong", "notification", "presence", "error"]


def build_event(*, type_: EventType, data: Any | None = None) -> str:
    payload: dict[str, Any] = {"type": type_}
    if data is not None:
        payload["data"] = data
    return json.dumps(payload, separators=(",", ":"), default=str)


def parse_event(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and "type" in parsed:
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return None
