"""RequestContextMiddleware: analytics identity across the middleware boundary.

`RequestContextMiddleware` is a `BaseHTTPMiddleware`, so the endpoint and its
dependencies are awaited in a child task that runs with a **copy** of the
contextvars context. A `user_id` bound inside `get_current_user` is therefore
invisible to the middleware once `call_next` returns and it resumes in the
outer task — every visit used to be recorded as anonymous, which silently
zeroed `traffic.authenticated_requests` and `users.active_last_24d`.

The invariant pinned below: identity reaches the recorder through
`request.state` (the ASGI scope, the one object shared across that boundary),
not through contextvars.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
import structlog
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from social_api import deps as deps_mod
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user, get_current_user_allow_deleted
from social_api.middleware import RequestContextMiddleware
from social_api.modules.analytics import recorder as recorder_mod
from social_api.modules.auth.models import User, UserRole

pytestmark = pytest.mark.unit

USER_ID = 7
AUTH_HEADERS = {"Authorization": "Bearer test-token"}


class _CapturedCalls:
    """Stand-in for `recorder.record_request` that records its keyword args."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> None:
        self.calls.append(kwargs)

    @property
    def last(self) -> dict[str, Any]:
        assert self.calls, "record_request was never called"
        return self.calls[-1]


def _fake_user() -> User:
    return User(
        id=USER_ID,
        email="analytics@example.com",
        email_hash="h",
        password_hash="x",
        role=UserRole.USER,
        is_active=True,
    )


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> _CapturedCalls:
    """Capture what the middleware hands to the recorder.

    The middleware holds a module reference (`analytics_recorder.request`),
    so patching the attribute on the module is what takes effect.
    """
    calls = _CapturedCalls()
    monkeypatch.setattr(recorder_mod, "record_request", calls)
    return calls


@pytest.fixture
def token_user(monkeypatch: pytest.MonkeyPatch) -> User:
    """Bypass JWT/DB: the user pipeline returns our fake user."""
    user = _fake_user()

    async def _load(*_args: Any, **_kwargs: Any) -> User:
        return user

    monkeypatch.setattr(deps_mod, "_load_user_from_token", _load)
    return user


def _build_app(dependency: Callable[..., Any] | None) -> FastAPI:
    """Tiny app: one route under /api/v1, wrapped in the real middleware."""
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    app.dependency_overrides[get_db] = lambda: object()

    if dependency is None:

        @app.get("/api/v1/probe")
        async def probe_anonymous() -> dict[str, str]:
            return {"probe": "anonymous"}

    else:

        @app.get("/api/v1/probe")
        async def probe_authenticated(
            user: CurrentUser = Depends(dependency),
        ) -> dict[str, int]:
            return {"user_id": user.user.id}

    return app


@pytest.mark.asyncio
async def test_authenticated_visit_records_user_id(
    captured: _CapturedCalls, token_user: User
) -> None:
    """The regression: an authenticated request must not be recorded as anonymous."""
    app = _build_app(get_current_user)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/probe", headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert response.json() == {"user_id": USER_ID}
    assert captured.last["user_id"] == USER_ID
    assert captured.last["path"] == "/api/v1/probe"
    assert captured.last["status_code"] == 200


@pytest.mark.asyncio
async def test_allow_deleted_dependency_records_user_id(
    captured: _CapturedCalls, token_user: User
) -> None:
    """The GDPR grace-window dependency must classify its visits too.

    It does not bind the structlog contextvar at all, so `request.state` is
    the only route by which analytics can learn the identity.
    """
    app = _build_app(get_current_user_allow_deleted)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/probe", headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert captured.last["user_id"] == USER_ID


@pytest.mark.asyncio
async def test_anonymous_visit_records_no_user_id(captured: _CapturedCalls) -> None:
    """Unauthenticated traffic stays anonymous — the fix must not invent identity."""
    app = _build_app(None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/probe")

    assert response.status_code == 200
    assert captured.last["user_id"] is None


@pytest.mark.asyncio
async def test_contextvar_bound_in_dependency_is_not_visible_to_middleware(
    captured: _CapturedCalls,
) -> None:
    """Pins *why* `request.state` is used, so the fix can't be "simplified".

    A contextvar bound inside a dependency runs in the child task's context
    copy and never reaches the middleware. If Starlette ever changes that,
    this test flips and the state channel becomes optional — which is
    precisely the signal a future maintainer needs.
    """
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    def _bind_contextvar_only() -> str:
        structlog.contextvars.bind_contextvars(user_id=USER_ID)
        return "bound"

    @app.get("/api/v1/probe")
    async def probe(_: str = Depends(_bind_contextvar_only)) -> dict[str, str]:
        return {"probe": "contextvar"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/probe")

    assert response.status_code == 200
    assert captured.last["user_id"] is None


@pytest.mark.asyncio
async def test_middleware_never_fails_request_when_recorder_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Analytics is best-effort: a broken recorder must not break the response."""

    def _boom(**_kwargs: Any) -> None:
        raise RuntimeError("recorder exploded")

    monkeypatch.setattr(recorder_mod, "record_request", _boom)

    app = _build_app(None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/probe")

    assert response.status_code == 200
