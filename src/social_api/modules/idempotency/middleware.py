"""Idempotency HTTP middleware."""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from social_api.core.security import ACCESS, decode_token
from social_api.db.session import get_sessionmaker
from social_api.logging_config import get_logger
from social_api.modules.idempotency.exceptions import (
    IdempotencyConflictError,
    IdempotencyInProgressError,
)
from social_api.modules.idempotency.service import (
    IdempotencyService,
    hash_body,
)

logger = get_logger(__name__)

RequestHandler = Callable[[Request], Awaitable[Response]]

_IDEMPOTENT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^/api/v1/posts$"), "POST"),
    (re.compile(r"^/api/v1/posts/\d+/comments$"), "POST"),
    (re.compile(r"^/api/v1/likes/[a-z]+/\d+$"), "POST"),
    (re.compile(r"^/api/v1/follows/\d+$"), "POST"),
    (re.compile(r"^/api/v1/chat/rooms/\d+/messages$"), "POST"),
    (re.compile(r"^/api/v1/media$"), "POST"),
    (re.compile(r"^/api/v1/moderation/reports$"), "POST"),
]

_HEADER = "idempotency-key"
_MAX_KEY_LEN = 128
_MIN_KEY_LEN = 8


def _is_idempotent_route(method: str, path: str) -> bool:
    return any(
        m == method and pattern.match(path) is not None for pattern, m in _IDEMPOTENT_PATTERNS
    )


def _extract_user_id(request: Request) -> int | None:
    """Light JWT decode (no blacklist check — endpoint will verify)."""
    auth = request.headers.get("authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    token = auth.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token, expected_type=ACCESS)
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def _error_response(
    request: Request,
    *,
    status: int,
    code: str,
    detail: str,
) -> JSONResponse:

    return JSONResponse(
        status_code=status,
        content={
            "error": code,
            "status": status,
            "detail": detail,
            "path": request.url.path,
            "request_id": getattr(request.state, "request_id", None),
        },
    )


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestHandler) -> Response:
        if not _is_idempotent_route(request.method, request.url.path):
            return await call_next(request)

        raw_key = request.headers.get(_HEADER)
        if not raw_key:
            return await call_next(request)
        if not (_MIN_KEY_LEN <= len(raw_key) <= _MAX_KEY_LEN):
            return _error_response(
                request,
                status=400,
                code="INVALID_IDEMPOTENCY_KEY",
                detail=(f"Idempotency-Key must be {_MIN_KEY_LEN}-{_MAX_KEY_LEN} chars"),
            )

        user_id = _extract_user_id(request)
        if user_id is None:
            # No auth yet — pass through; endpoint will 401.
            return await call_next(request)

        body = await request.body()
        rhash = hash_body(body)

        state: str
        cached_body: dict[str, object] | None = None
        cached_status: int | None = None

        async with get_sessionmaker()() as session:
            svc = IdempotencyService(session)
            state, cached_body, cached_status = await svc.check_or_reserve(
                key=raw_key,
                user_id=user_id,
                endpoint=request.url.path,
                method=request.method,
                request_hash=rhash,
            )
            await session.commit()

        # ---- Translate state into response / error envelope ----
        # Codes are pulled from the exception classes so the middleware
        # and the raise_if_blocked() path emit identical strings — any
        # future rename updates both atomically.
        if state == "conflict":
            conflict_exc = IdempotencyConflictError()
            return _error_response(
                request,
                status=conflict_exc.status_code,
                code=conflict_exc.code,
                detail=conflict_exc.default_message,
            )
        if state == "in_progress":
            progress_exc = IdempotencyInProgressError()
            return _error_response(
                request,
                status=progress_exc.status_code,
                code=progress_exc.code,
                detail=progress_exc.default_message,
            )

        if state == "hit" and cached_status is not None:
            return JSONResponse(
                status_code=cached_status,
                content=cached_body or {},
                headers={"Idempotent-Replay": "true"},
            )

        # Miss → execute handler
        response = await call_next(request)

        if 200 <= response.status_code < 500:
            body_bytes = b""
            async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                body_bytes += chunk
            new_response = Response(
                content=body_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

            parsed: dict[str, object] | None = None
            if body_bytes:
                try:
                    parsed = json.loads(body_bytes)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    parsed = None

            async with get_sessionmaker()() as session:
                await IdempotencyService(session).record_response(
                    key=raw_key,
                    user_id=user_id,
                    status=response.status_code,
                    body=parsed,
                )
                await session.commit()

            return new_response

        return response
