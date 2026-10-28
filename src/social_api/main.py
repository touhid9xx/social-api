"""FastAPI application entry point."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.types import ExceptionHandler

from social_api import __version__
from social_api.cache.redis import close_redis, init_redis
from social_api.config import get_settings
from social_api.db.session import dispose_engine, init_engine
from social_api.exceptions import register_exception_handlers
from social_api.i18n import t
from social_api.logging_config import configure_logging, get_logger
from social_api.middleware import register_middleware
from social_api.modules.idempotency.middleware import IdempotencyMiddleware
from social_api.observability.health import router as health_router
from social_api.observability.metrics import setup_metrics
from social_api.observability.tracing import setup_tracing
from social_api.realtime.manager import manager

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging()
    logger.info(
        "app_startup",
        service=settings.app_name,
        version=__version__,
        env=settings.app_env,
    )

    # Wire infrastructure
    init_engine()
    init_redis()

    try:
        yield
    finally:
        await manager.close_all()
        await close_redis()
        await dispose_engine()
        logger.info("app_shutdown", service=settings.app_name)


def create_app() -> FastAPI:
    """App factory — testable and reusable."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description="Social media backend (modular monolith)",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(IdempotencyMiddleware)
    register_middleware(app)

    # ---- Rate limiting ----
    # NOTE: @limiter.limit(...) decorators on routes are the source of truth
    # for per-endpoint limits. SlowAPIMiddleware is NOT added — it would
    # double-count each request (middleware + decorator) and trip limits at
    # half the configured rate.
    from social_api.core.rate_limit import limiter, rate_limit_error_handler

    app.state.limiter = limiter
    app.add_exception_handler(
        RateLimitExceeded,
        cast(ExceptionHandler, rate_limit_error_handler),
    )

    register_exception_handlers(app)
    setup_tracing(app)
    setup_metrics(app)

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, Any]:
        return {
            "service": settings.app_name,
            "version": __version__,
            "docs": "/docs",
            "openapi": "/openapi.json",
            "health": "/health",
        }

    app.include_router(health_router)

    from social_api.api.v1 import api_router

    # WS router under /api/v1
    from social_api.api.v1.ws import router as ws_router

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    app.include_router(ws_router, prefix=settings.api_v1_prefix)

    @app.get("/_i18n_demo", include_in_schema=False)
    async def i18n_demo(request: Request) -> JSONResponse:
        locale = request.headers.get("Accept-Language")
        return JSONResponse(
            {
                "en": t("health.ok", locale="en"),
                "bn": t("health.ok", locale="bn"),
                "requested": t("health.ok", locale=locale),
                "requested_locale_header": locale,
            }
        )

    # Static media (local backend only)
    if settings.app_env in {"development", "staging"}:
        from pathlib import Path

        from fastapi.staticfiles import StaticFiles

        media_dir = Path(settings.media_root)
        media_dir.mkdir(parents=True, exist_ok=True)
        app.mount(
            "/static/media",
            StaticFiles(directory=str(media_dir)),
            name="static-media",
        )

    return app


app = create_app()
