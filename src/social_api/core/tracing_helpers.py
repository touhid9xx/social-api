"""Manual span helpers for code paths that OTel auto-instrumentation
doesn't reach (business logic, Redis pub/sub, feed assembly).

Design:
  - No-op when OTel is not installed or disabled — business code never breaks.
  - Yield exactly once (contextlib.contextmanager requirement). The old
    "except Exception: yield" fallback yielded twice on span-close
    failure, producing RuntimeError inside the with block.
  - Attribute values are coerced to OTel-safe primitives (str/bool/int/
    float). OTel raises on None/UUID/enums, and suppressing that would
    silently drop the attribute — worse than stringifying None.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from social_api.logging_config import get_logger

logger = get_logger(__name__)

# Optional dependency. Missing otel → no-op span; never raise.
# Declared Any so mypy doesn't fight the Module → None assignment
# in the except branch. Same pattern as redis/celery/prometheus
# optional imports across the codebase.
_otel_trace: Any = None
_tracer: Any = None
_OTEL_AVAILABLE: bool = False

try:
    from opentelemetry import trace as _otel_mod

    _otel_trace = _otel_mod
    _tracer = _otel_mod.get_tracer("social-api")
    _OTEL_AVAILABLE = True
except ImportError:  # pragma: no cover — otel extra not installed
    pass


_OtelValue = str | bool | int | float


def _otel_safe(v: Any) -> _OtelValue:
    """Coerce a value to something OTel's set_attribute accepts.

    Preserves native str/bool/int/float. Everything else (None, UUID,
    enum, list of mixed) is stringified — a traceable string beats a
    silently-dropped attribute.
    """
    if isinstance(v, (str, bool, int, float)):
        return v
    return str(v)


@contextlib.contextmanager
def span(
    name: str,
    attributes: dict[str, Any] | None = None,
) -> Iterator[None]:
    """Start a manual OTel span; no-op when OTel is unavailable.

    Safe to nest. Never raises. Yields exactly once.
    """
    if not _OTEL_AVAILABLE or _tracer is None:
        yield
        return

    try:
        with _tracer.start_as_current_span(name) as sp:
            if attributes:
                for k, v in attributes.items():
                    with contextlib.suppress(Exception):
                        sp.set_attribute(k, _otel_safe(v))
            # Single yield: hands control to the with-block body.
            yield
    except Exception as exc:  # pragma: no cover — otel optional
        # Span-close failure must never fail the request. Log at debug
        # so it's traceable in dev. Do NOT yield again — contextlib
        # would raise "generator didn't stop after throw()".
        logger.debug(
            "otel_span_failed",
            span_name=name,
            error=type(exc).__name__,
        )
