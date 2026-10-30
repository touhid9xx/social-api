"""Email endpoints are registered at 3 requests/hour (slowapi route limits).

The autouse `_disable_rate_limit` fixture in conftest neutralises
`strategy.hit`, so behavioural 429s cannot be asserted here. What matters
(and what regresses silently) is the *registration*: the decorator's
limit value is captured in `limiter._route_limits` at import time.
"""

from __future__ import annotations

from typing import Any, cast

import pytest

from social_api.core.rate_limit import limiter
from social_api.modules.auth import router as auth_router  # noqa: F401  # import side effect

pytestmark = pytest.mark.unit

_MODULE = "social_api.modules.auth.router"
_EMAIL_ENDPOINTS = ("verify_email", "forgot_password", "reset_password")


def _route_limits() -> dict[str, list[Any]]:
    return cast(
        "dict[str, list[Any]]",
        getattr(limiter, "_route_limits"),  # noqa: B009  # slowapi private map
    )


@pytest.mark.parametrize("endpoint", _EMAIL_ENDPOINTS)
def test_email_endpoint_registered_at_three_per_hour(endpoint: str) -> None:
    key = f"{_MODULE}.{endpoint}"
    limits = _route_limits().get(key)

    assert limits, f"no rate limit registered for {key}"
    assert len(limits) == 1, f"unexpected extra limits for {key}: {limits}"

    # slowapi wraps the parsed `RateLimitItem`; that is where amount/granularity live.
    parsed = limits[0].limit
    assert parsed.amount == 3
    assert parsed.get_expiry() == 3600


@pytest.mark.parametrize("endpoint", _EMAIL_ENDPOINTS)
def test_email_endpoints_use_user_or_ip_key(endpoint: str) -> None:
    """Per-user when authenticated, else per-IP (mail-bomb protection)."""
    from social_api.core.rate_limit import _key_by_user_or_ip

    key = f"{_MODULE}.{endpoint}"
    limit = _route_limits()[key][0]

    assert limit.key_func is _key_by_user_or_ip
