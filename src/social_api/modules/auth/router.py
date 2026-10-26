"""Auth HTTP endpoints — thin translation HTTP <-> AuthService."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.auth.schemas import (
    AuthTokens,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    UserPublic,
)
from social_api.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _service(session: AsyncSession) -> AuthService:
    """Construct AuthService — it builds UserRepository internally."""
    return AuthService(session)


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute", key_func=_key_by_ip)
async def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> RegisterResponse:
    result = await _service(session).register(email=payload.email, password=payload.password)
    # Commit BEFORE response is sent — ensures subsequent requests see the
    # row. With BaseHTTPMiddleware in the stack (SlowAPI, Prometheus),
    # yield-dependency teardown runs AFTER the response is sent, so a
    # client that immediately hits /me or /login would race the commit.
    await session.commit()
    return result


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute", key_func=_key_by_ip)
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> LoginResponse:
    result = await _service(session).login(email=payload.email, password=payload.password)
    # Commit last_login_at + LOGIN audit before response.
    await session.commit()
    return result


@router.post("/refresh", response_model=AuthTokens)
@limiter.limit("30/minute", key_func=_key_by_ip)
async def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> AuthTokens:
    result = await _service(session).refresh(refresh_token=payload.refresh_token)
    await session.commit()
    return result


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def logout(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    # Pass user_id from the authenticated dependency — already decoded
    # and validated. No need to decode the access token ourselves; the
    # token's only job here is to get revoked (Redis blacklist).
    await _service(session).logout(user_id=user.user.id, access_token=user.raw_token)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserPublic)
async def me(user: CurrentUser = Depends(get_current_user)) -> UserPublic:
    u = user.user
    return UserPublic(
        id=u.id,
        role=u.role.value,
        is_active=u.is_active,
        is_verified=u.is_verified,
        created_at=u.created_at,
    )
