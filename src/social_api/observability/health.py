"""Health endpoints (liveness + readiness + per-dependency probes)."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from social_api.cache.redis import ping_redis
from social_api.config import get_settings
from social_api.db.session import ping_db
from social_api.deps import CurrentUser, require_roles
from social_api.logging_config import get_logger
from social_api.modules.auth.models import UserRole

logger = get_logger(__name__)
router = APIRouter(tags=["health"])

_Status = Literal["ok", "degraded", "down"]


def _check_payload(
    *,
    ok: bool,
    latency_ms: float,
    error: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "ok" if ok else "down",
        "latency_ms": latency_ms,
    }
    if error is not None:
        payload["error"] = error
    return payload


@router.get("/health", summary="Liveness probe", operation_id="liveness")
async def health() -> dict[str, Any]:
    """Returns 200 if the process is up. No dependency checks."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": "0.1.0",
        "env": settings.app_env,
    }


@router.get(
    "/health/db",
    summary="Database readiness probe",
    operation_id="health_db",
)
async def health_db() -> JSONResponse:
    ok, latency_ms, error = await ping_db()
    body = _check_payload(ok=ok, latency_ms=latency_ms, error=error)
    return JSONResponse(status_code=200 if ok else 503, content=body)


@router.get(
    "/health/redis",
    summary="Redis readiness probe",
    operation_id="health_redis",
)
async def health_redis() -> JSONResponse:
    ok, latency_ms, error = await ping_redis()
    body = _check_payload(ok=ok, latency_ms=latency_ms, error=error)
    return JSONResponse(status_code=200 if ok else 503, content=body)


@router.get(
    "/health/ready",
    summary="Readiness probe (aggregate)",
    operation_id="readiness",
)
async def readiness() -> JSONResponse:
    db_ok, db_latency, db_err = await ping_db()
    redis_ok, redis_latency, redis_err = await ping_redis()

    db_payload = _check_payload(ok=db_ok, latency_ms=db_latency, error=db_err)
    redis_payload = _check_payload(ok=redis_ok, latency_ms=redis_latency, error=redis_err)

    checks = {"db": db_payload, "redis": redis_payload}

    if db_ok and redis_ok:
        overall: _Status = "ok"
        http_status = 200
        label = "ready"
    elif db_ok and not redis_ok:
        overall = "degraded"
        http_status = 200  # let app serve reads without cache
        label = "degraded"
    else:
        overall = "down"
        http_status = 503
        label = "not_ready"

    return JSONResponse(
        status_code=http_status,
        content={"status": label, "overall": overall, "checks": checks},
    )


@router.get(
    "/health/circuit-breakers",
    summary="Circuit-breaker snapshot (admin-only)",
    operation_id="health_circuit_breakers",
)
async def circuit_breakers(
    _user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> dict[str, object]:
    """In-memory snapshot of all circuit breakers. Admin-only.

    Never touches Redis/DB — this endpoint must work precisely when
    Redis is down, which is when you most need to see breaker state.
    """
    from social_api.core.circuit_breakers import all_breakers

    return {"breakers": [b.snapshot() for b in all_breakers()]}
