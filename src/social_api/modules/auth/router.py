"""Auth HTTP endpoints — thin translation HTTP <-> AuthService."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_ip, _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.i18n import t
from social_api.modules.auth.schemas import (
    AuthTokens,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    UserPublic,
    VerifyEmailRequest,
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
    result = await _service(session).register(
        email=payload.email,
        password=payload.password,
        locale=request.headers.get("accept-language"),
    )
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


# ---------------------------------------------------------------------------
# Email verification + password reset
#
# All three endpoints are capped at 3 requests/hour (per authenticated
# user, else per IP) — they either mint or consume one-time tokens, which
# are the classic brute-force / mail-bomb targets. Tokens are self-
# contained JWTs (`type` claim = "verify" | "reset"); no DB table.
# ---------------------------------------------------------------------------
@router.post("/verify-email", response_model=MessageResponse)
@limiter.limit("3/hour", key_func=_key_by_user_or_ip)
async def verify_email(
    request: Request,
    response: Response,
    payload: VerifyEmailRequest,
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    locale = request.headers.get("accept-language")
    await _service(session).verify_email(token=payload.token)
    await session.commit()
    return MessageResponse(message=t("auth.verify.success", locale=locale))


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit("3/hour", key_func=_key_by_user_or_ip)
async def forgot_password(
    request: Request,
    response: Response,
    payload: ForgotPasswordRequest,
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    # Always 200 with the same body, whether or not the address exists —
    # the response must not be an account-enumeration oracle.
    result = await _service(session).forgot_password(
        email=payload.email,
        locale=request.headers.get("accept-language"),
    )
    await session.commit()
    return result


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("3/hour", key_func=_key_by_user_or_ip)
async def reset_password(
    request: Request,
    response: Response,
    payload: ResetPasswordRequest,
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    result = await _service(session).reset_password(
        token=payload.token,
        new_password=payload.new_password,
        locale=request.headers.get("accept-language"),
    )
    await session.commit()
    return result
