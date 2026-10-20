"""Application error hierarchy + FastAPI exception handlers."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from social_api.logging_config import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    """Base application error. Every subclass has a stable `code`."""

    code: str = "APP_ERROR"
    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    message: str = "Internal server error"

    def __init__(
        self,
        message: str | None = None,
        *,
        detail: Any = None,
    ) -> None:
        self.message = message or self.message
        self.detail = detail
        super().__init__(self.message)


# ---- 4xx ----
class BadRequestError(AppError):
    code = "BAD_REQUEST"
    status_code = 400
    message = "Bad request"


class UnauthorizedError(AppError):
    code = "UNAUTHORIZED"
    status_code = 401
    message = "Authentication required"


class ForbiddenError(AppError):
    code = "FORBIDDEN"
    status_code = 403
    message = "You do not have permission to perform this action"


class NotFoundError(AppError):
    code = "NOT_FOUND"
    status_code = 404
    message = "Resource not found"


class ConflictError(AppError):
    code = "CONFLICT"
    status_code = 409
    message = "Resource conflict"


class TooManyRequestsError(AppError):
    code = "RATE_LIMITED"
    status_code = 429
    message = "Too many requests"


# ---- 5xx ----
class InternalError(AppError):
    code = "INTERNAL_ERROR"
    status_code = 500
    message = "Internal server error"


class ServiceUnavailableError(AppError):
    code = "SERVICE_UNAVAILABLE"
    status_code = 503
    message = "Service temporarily unavailable"


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------
def _error_body(
    *,
    code: str,
    status_code: int,
    detail: Any,
    path: str,
    request_id: str | None,
) -> dict[str, Any]:
    return {
        "error": code,
        "status": status_code,
        "detail": detail,
        "path": path,
        "request_id": request_id,
    }


def _get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    rid = _get_request_id(request)
    if exc.status_code >= 500:
        logger.error(
            "app_error",
            code=exc.code,
            status=exc.status_code,
            path=request.url.path,
            request_id=rid,
            detail=exc.detail,
        )
    else:
        logger.warning(
            "app_client_error",
            code=exc.code,
            status=exc.status_code,
            path=request.url.path,
            request_id=rid,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(
            code=exc.code,
            status_code=exc.status_code,
            detail=exc.detail or exc.message,
            path=request.url.path,
            request_id=rid,
        ),
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    rid = _get_request_id(request)
    return JSONResponse(
        status_code=exc.status_code,
        content=_error_body(
            code=f"HTTP_{exc.status_code}",
            status_code=exc.status_code,
            detail=exc.detail,
            path=request.url.path,
            request_id=rid,
        ),
        headers=exc.headers or None,
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    rid = _get_request_id(request)
    logger.warning(
        "validation_error",
        path=request.url.path,
        request_id=rid,
        errors=exc.errors(),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_error_body(
            code="VALIDATION_ERROR",
            status_code=422,
            detail=exc.errors(),
            path=request.url.path,
            request_id=rid,
        ),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = _get_request_id(request)
    logger.exception(
        "unhandled_exception",
        path=request.url.path,
        request_id=rid,
    )
    return JSONResponse(
        status_code=500,
        content=_error_body(
            code="INTERNAL_ERROR",
            status_code=500,
            detail="Internal server error",
            path=request.url.path,
            request_id=rid,
        ),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach all handlers to a FastAPI app."""
    app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)
