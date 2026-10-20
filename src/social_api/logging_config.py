"""structlog configuration with PII redaction."""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from social_api.config import get_settings

# ---------------------------------------------------------------------------
# PII redaction — deny-list of keys whose VALUES must never appear in logs.
# ---------------------------------------------------------------------------
PII_KEYS: frozenset[str] = frozenset(
    {
        "email",
        "phone",
        "address",
        "dob",
        "password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "jti",
        "cookie",
        "set-cookie",
    }
)

REDACTED = "***REDACTED***"


def _redact_pii(_logger: Any, _method: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor: scrub PII keys from every log event."""
    for key in list(event_dict.keys()):
        if key.lower() in PII_KEYS:
            event_dict[key] = REDACTED
    # also scrub nested dicts one level deep (headers etc.)
    for _k, v in event_dict.items():
        if isinstance(v, dict):
            for nested_key in list(v.keys()):
                if nested_key.lower() in PII_KEYS:
                    v[nested_key] = REDACTED
    return event_dict


def configure_logging() -> None:
    """Configure structlog + stdlib logging. Call once at startup."""
    settings = get_settings()
    level = getattr(logging, settings.log_level, logging.INFO)

    # stdlib logging (for uvicorn, sqlalchemy, etc.)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
        force=True,
    )

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _redact_pii,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.log_format == "json":
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Quiet noisy third-party loggers
    for noisy in ("uvicorn.access", "sqlalchemy.engine.Engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a structlog logger (typed)."""
    return structlog.get_logger(name)  # type: ignore[no-any-return]
