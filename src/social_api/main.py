"""FastAPI application entry point."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from social_api import __version__
from social_api.cache.redis import close_redis, init_redis
from social_api.config import get_settings
from social_api.db.session import dispose_engine, init_engine
from social_api.exceptions import register_exception_handlers
from social_api.i18n import t
from social_api.logging_config import configure_logging, get_logger
from social_api.middleware import register_middleware
from social_api.observability.health import router as health_router
from social_api.observability.metrics import setup_metrics
from social_api.observability.tracing import setup_tracing

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

    register_middleware(app)
    from social_api.core.rate_limit import limiter, rate_limit_error_handler

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, rate_limit_error_handler)  # type: ignore[arg-type]

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

    app.include_router(api_router, prefix=settings.api_v1_prefix)

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

    return app


app = create_app()
