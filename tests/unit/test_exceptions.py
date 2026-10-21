"""Error hierarchy + handler response shape."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel

from social_api.exceptions import (
    AppError,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    InternalError,
    NotFoundError,
    ServiceUnavailableError,
    TooManyRequestsError,
    UnauthorizedError,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("exc_cls", "expected_status", "expected_code"),
    [
        (BadRequestError, 400, "BAD_REQUEST"),
        (UnauthorizedError, 401, "UNAUTHORIZED"),
        (ForbiddenError, 403, "FORBIDDEN"),
        (NotFoundError, 404, "NOT_FOUND"),
        (ConflictError, 409, "CONFLICT"),
        (TooManyRequestsError, 429, "RATE_LIMITED"),
        (InternalError, 500, "INTERNAL_ERROR"),
        (ServiceUnavailableError, 503, "SERVICE_UNAVAILABLE"),
    ],
)
def test_error_classes_have_stable_metadata(
    exc_cls: type[AppError], expected_status: int, expected_code: str
) -> None:
    e = exc_cls()
    assert e.status_code == expected_status
    assert e.code == expected_code


def test_error_custom_message_and_detail() -> None:
    e = NotFoundError("Post not found", detail={"id": 99})
    assert str(e) == "Post not found"
    assert e.detail == {"id": 99}


async def test_not_found_handler_shape(app: FastAPI, client: AsyncClient) -> None:
    """Trigger a NotFoundError inside a route and verify the JSON shape."""

    @app.get("/_test/notfound")
    async def _raise() -> None:
        raise NotFoundError("Post not found", detail={"id": 99})

    r = await client.get("/_test/notfound")
    assert r.status_code == 404
    body = r.json()
    assert body["error"] == "NOT_FOUND"
    assert body["status"] == 404
    assert body["detail"] == {"id": 99}
    assert body["path"] == "/_test/notfound"
    assert body["request_id"]


async def test_validation_error_shape(app: FastAPI, client: AsyncClient) -> None:
    """Pydantic validation failures route through our handler."""

    class _Payload(BaseModel):
        count: int

    @app.post("/_test/validate")
    async def _echo(payload: _Payload) -> dict[str, int]:
        return {"count": payload.count}

    r = await client.post("/_test/validate", json={"count": "not-an-int"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "VALIDATION_ERROR"
    assert body["status"] == 422
    assert isinstance(body["detail"], list)
    assert body["request_id"]


async def test_handlers_include_request_id_header(client: AsyncClient) -> None:
    r = await client.get("/does-not-exist")
    assert "X-Request-ID" in r.headers
    assert r.json()["request_id"] == r.headers["X-Request-ID"]
