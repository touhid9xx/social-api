"""Cursor pagination — opaque, tamper-evident, no OFFSET on big tables.

Encodes an ordered set of columns (e.g. `created_at DESC, id DESC`) into a
URL-safe base64 token. Clients pass it back verbatim as `?cursor=`.

Design:
  - Cursor is `base64url(json({"k": [...values], "s": signature}))`.
  - Signature = HMAC-SHA256(ENCRYPTION_KEY, canonical-json) truncated to 16 bytes.
  - This prevents clients from forging cursors (e.g. to skip visibility rules).
  - Cursor itself is NOT a security boundary for authz — authz is still enforced
    server-side — but it stops trivially malformed/probing cursors.

Wire shape:
    GET /api/v1/posts?limit=20&cursor=eyJ...
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from typing import Any, Final

from social_api.config import get_settings

_SEP: Final[str] = "."
_SIG_BYTES: Final[int] = 16
_MAX_LIMIT: Final[int] = 100
_DEFAULT_LIMIT: Final[int] = 20


class PaginationError(ValueError):
    """Raised when a cursor is malformed or its signature is invalid."""


def _sig_key() -> bytes:
    """Derive HMAC key from ENCRYPTION_KEY. Falls back to a dev key if unset."""
    settings = get_settings()
    raw = settings.encryption_key or "dev-only-insecure-key-change-me"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _sign(body: bytes) -> str:
    mac = hmac.new(_sig_key(), body, hashlib.sha256).digest()[:_SIG_BYTES]
    return base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def encode_cursor(values: list[Any]) -> str:
    """
    Encode an ordered list of column values into an opaque cursor.

    Values must be JSON-serializable. datetimes are converted to ISO-8601 UTC.
    """
    serialized = [_to_json_value(v) for v in values]
    payload = {"k": serialized}
    body = _canonical(payload)
    token = base64.urlsafe_b64encode(body).decode("ascii").rstrip("=")
    return f"{token}{_SEP}{_sign(body)}"


def decode_cursor(cursor: str) -> list[Any]:
    """
    Decode a cursor string back to its ordered column values.

    Raises PaginationError on any tampering, malformed input, or bad signature.
    """
    if not isinstance(cursor, str) or _SEP not in cursor:
        raise PaginationError("Malformed cursor")
    token, signature = cursor.rsplit(_SEP, 1)
    try:
        padded = token + "=" * (-len(token) % 4)
        body = base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise PaginationError("Malformed cursor body") from exc

    expected = _sign(body)
    if not hmac.compare_digest(signature, expected):
        raise PaginationError("Invalid cursor signature")

    try:
        payload: dict[str, Any] = json.loads(body)
        values = payload["k"]
        if not isinstance(values, list):
            raise PaginationError("Malformed cursor payload")
        return values
    except (json.JSONDecodeError, KeyError) as exc:
        raise PaginationError("Malformed cursor payload") from exc


def _to_json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat()
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    raise PaginationError(f"Unsupported cursor value type: {type(value).__name__}")


def clamp_limit(limit: int | None) -> int:
    """Clamp client-requested limit to [1, _MAX_LIMIT]. None -> default."""
    if limit is None:
        return _DEFAULT_LIMIT
    if limit < 1:
        return 1
    if limit > _MAX_LIMIT:
        return _MAX_LIMIT
    return limit
