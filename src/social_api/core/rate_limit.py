"""slowapi limiter + per-IP / per-user key funcs."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)


def _key_by_ip(request: Request) -> str:
    return get_remote_address(request)


def _key_by_user_or_ip(request: Request) -> str:
    # If authenticated, use user_id; else fall back to IP.
    user = getattr(request.state, "user", None)
    if user is not None and getattr(user, "id", None) is not None:
        return f"user:{user.id}"
    return f"ip:{get_remote_address(request)}"


_settings = get_settings()

limiter = Limiter(
    key_func=_key_by_ip,
    default_limits=[],
    storage_uri=_settings.redis_url,
    enabled=_settings.rate_limit_enabled,
    headers_enabled=True,
    swallow_errors=True,  # if Redis is down, don't 500 the request
)


async def rate_limit_error_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Handle slowapi's RateLimitExceeded — return a 429 JSONResponse.

    Starlette's exception handler MUST return a Response. The previous
    implementation returned a TooManyRequestsError() instance, which
    Starlette tried to `await response(...)` on — TypeError:
    'TooManyRequestsError' object is not callable.

    The JSON envelope matches the app-wide error shape:
    { error, status, detail, path, request_id }.
    """
    request_id = getattr(request.state, "request_id", None)
    detail = getattr(exc, "detail", "Rate limit exceeded")

    logger.warning(
        "rate_limit_exceeded",
        path=request.url.path,
        request_id=request_id,
        detail=str(detail),
    )

    return JSONResponse(
        status_code=429,
        content={
            "error": "RATE_LIMITED",
            "status": 429,
            "detail": str(detail),
            "path": request.url.path,
            "request_id": request_id,
        },
        headers={"Retry-After": "60"},
    )


async def check_ws_connect_limit(*, ip: str, limit: int = 10, window_seconds: int = 60) -> bool:
    """Manual rate limit for WS upgrades. Fail-open if Redis is down."""
    from social_api.cache.redis import get_redis, guarded

    async def _do() -> bool:
        client = get_redis()
        key = f"rl:ws:{ip}"
        count = int(await client.incr(key))
        if count == 1:
            await client.expire(key, window_seconds)
        return count <= limit

    return await guarded(_do, default=True, op="ws_connect_limit")
