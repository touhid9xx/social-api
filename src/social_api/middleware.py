"""HTTP middleware: request ID, timing, security headers, CORS."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from social_api.config import get_settings
from social_api.logging_config import get_logger

# OTel is optional — bind trace_id when available, stay silent when not.
_otel_trace: Any = None
try:
    from opentelemetry import trace as _otel_mod

    _otel_trace = _otel_mod
except ImportError:  # pragma: no cover — otel extra not installed
    pass

logger = get_logger(__name__)

RequestHandler = Callable[[Request], Awaitable[Response]]


def _build_request_context(request: Request, request_id: str) -> dict[str, Any]:
    """Build the structlog contextvars dict for one request.

    - request_id, client_ip, user_agent: always bound (client_ip is raw
      here so AuditService can persist it; the PII processor redacts it
      at log-emit time).
    - trace_id: bound only when an OTel span is active (W3C traceparent
      format — 32 hex chars).
    """
    ctx: dict[str, Any] = {
        "request_id": request_id,
        "client_ip": (request.client.host if request.client else None),
        "user_agent": request.headers.get("user-agent"),
    }
    if _otel_trace is not None:
        try:
            span_ctx = _otel_trace.get_current_span().get_span_context()
            if span_ctx.is_valid:
                ctx["trace_id"] = format(span_ctx.trace_id, "032x")
        except Exception as exc:  # pragma: no cover — otel optional
            logger.debug("otel_trace_bind_failed", error=type(exc).__name__)
    return ctx


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assigns request_id, binds client_ip + user_agent + trace_id, measures latency.

    Context values are bound to structlog.contextvars so downstream
    handlers (e.g. AuditService) can read them via
    structlog.contextvars.get_contextvars() without plumbing the
    request object through every call.

    PII note: client_ip is bound raw so the audit service can persist it,
    but it is redacted at log-emit time by the PII processor in
    logging_config.py.
    """

    async def dispatch(self, request: Request, call_next: RequestHandler) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            **_build_request_context(request, request_id),
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "request_failed",
                method=request.method,
                path=request.url.path,
                latency_ms=round(elapsed_ms, 2),
            )
            # Clear AFTER the failure log so trace_id/request_id are
            # present on request_failed. Exception handlers upstream
            # use request.state, so they're unaffected by the clear.
            structlog.contextvars.clear_contextvars()
            raise

        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"

        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            latency_ms=round(elapsed_ms, 2),
        )
        # Clear AFTER request_completed so trace_id/request_id appear on
        # the latency log too. The finally-block clear was the bug: it
        # fired before this log, leaving request_completed without
        # trace_id in exactly the line ops teams filter on.
        structlog.contextvars.clear_contextvars()
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds baseline security headers to every response."""

    async def dispatch(self, request: Request, call_next: RequestHandler) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=()",
        )
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
        return response


def register_middleware(app: FastAPI) -> None:
    """Attach middleware. Order: outermost added last."""
    settings = get_settings()

    # innermost → outermost
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Process-Time-Ms"],
    )
