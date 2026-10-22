"""slowapi limiter + per-IP / per-user key funcs."""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from social_api.config import get_settings
from social_api.exceptions import TooManyRequestsError


def _key_by_ip(request: Request) -> str:
    return get_remote_address(request)


def _key_by_user_or_ip(request: Request) -> str:
    # If authenticated, use user_id; else fall back to IP
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


def rate_limit_error_handler(request: Request, exc: Exception) -> TooManyRequestsError:
    """Bridge slowapi's RateLimitExceeded into our AppError shape."""
    return TooManyRequestsError()
