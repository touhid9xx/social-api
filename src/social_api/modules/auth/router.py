"""Auth HTTP endpoints — thin translation HTTP <-> AuthService."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.auth.repository import UserRepository
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
    return AuthService(UserRepository(session))


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
    return await _service(session).register(email=payload.email, password=payload.password)


@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute", key_func=_key_by_ip)
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> LoginResponse:
    return await _service(session).login(email=payload.email, password=payload.password)


@router.post("/refresh", response_model=AuthTokens)
@limiter.limit("30/minute", key_func=_key_by_ip)
async def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> AuthTokens:
    return await _service(session).refresh(refresh_token=payload.refresh_token)


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
    # CurrentUser already validated access token; blacklist it.
    access_token = user.raw_token
    await _service(session).logout(access_token=access_token)
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
