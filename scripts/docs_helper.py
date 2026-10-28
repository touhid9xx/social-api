"""Helper for attaching `x-` extensions to FastAPI route OpenAPI schemas.

Usage:
    from scripts.docs_helper import meta

    @router.get("/admin/only", **meta(roles=["admin"], rate_limit="5/minute"))
    async def admin_only(...): ...

Note: this module lives under `scripts/` for portability; production code
should NOT import from scripts — it's used only in route definitions to
attach documentation metadata. Runtime impact is nil (openapi_extra is
consumed only by /openapi.json).
"""

from __future__ import annotations

from typing import Any


def meta(
    *,
    roles: list[str] | None = None,
    rate_limit: str | None = None,
) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    if roles:
        extra["x-required-roles"] = roles
    if rate_limit:
        extra["x-rate-limit"] = rate_limit
    return {"openapi_extra": extra} if extra else {}
