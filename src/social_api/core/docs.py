"""Documentation helpers: attach `x-` extensions to route OpenAPI schemas.

This is metadata only — has zero runtime impact (consumed only by
/openapi.json and the contract export script).
"""

from __future__ import annotations

from typing import Any


def meta(
    *,
    roles: list[str] | None = None,
    rate_limit: str | None = None,
) -> dict[str, Any]:
    """
    Build kwargs to spread into a FastAPI route decorator:

        @router.get("/x", **meta(roles=["admin"], rate_limit="5/minute"))
        async def x(...): ...
    """
    extra: dict[str, Any] = {}
    if roles:
        extra["x-required-roles"] = roles
    if rate_limit:
        extra["x-rate-limit"] = rate_limit
    return {"openapi_extra": extra} if extra else {}
