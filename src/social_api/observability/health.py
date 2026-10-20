"""Health endpoints (liveness + readiness)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness probe")
async def health() -> dict[str, Any]:
    """Returns 200 if the process is up. No dependency checks."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": "0.1.0",
        "env": settings.app_env,
    }


@router.get("/health/ready", summary="Readiness probe")
async def readiness() -> JSONResponse:
    """
    Returns 200 only if dependencies are OK.
    M0: DB/Redis not wired yet -> report them as 'not_configured'.
    Later milestones fill them in.
    """
    checks: dict[str, dict[str, Any]] = {
        "db": {"status": "not_configured"},
        "redis": {"status": "not_configured"},
        "celery": {"status": "not_configured"},
    }
    # All 'not_configured' is OK for M0 (no deps used yet)
    ready = all(c["status"] in {"ok", "not_configured"} for c in checks.values())
    status_code = 200 if ready else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )
