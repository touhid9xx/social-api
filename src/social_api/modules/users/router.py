"""Users HTTP endpoints — /me routes declared BEFORE /{user_id}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.users.schemas import (
    ConsentGrantRequest,
    ConsentList,
    DeleteMeResponse,
    ProfilePublic,
    ProfileSelf,
    ProfileUpdate,
)
from social_api.modules.users.service import UsersService

router = APIRouter(prefix="/users", tags=["users"])


def _svc(session: AsyncSession) -> UsersService:
    return UsersService(session)


@router.get("/me", response_model=ProfileSelf)
async def get_me(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfileSelf:
    result = await _svc(session).get_self_profile(user_id=user.user.id)
    await session.commit()  # get_self_profile may create default profile
    return result


@router.patch("/me", response_model=ProfileSelf)
async def update_me(
    payload: ProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfileSelf:
    result = await _svc(session).update_profile(user_id=user.user.id, payload=payload)
    await session.commit()
    return result


@router.post("/me/consent", status_code=201)
async def grant_consent(
    payload: ConsentGrantRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    await _svc(session).grant_consent(
        user_id=user.user.id,
        channel=payload.channel,
        ip=client_ip,
        user_agent=user_agent,
    )
    await session.commit()
    return {"message": "Consent recorded"}


@router.delete(
    "/me/consent/{channel}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def revoke_consent(
    channel: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).revoke_consent(user_id=user.user.id, channel=channel)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/consent", response_model=ConsentList)
async def list_consents(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConsentList:
    rows = await _svc(session).list_consents(user_id=user.user.id)
    return ConsentList(consents=rows)


@router.delete("/me", response_model=DeleteMeResponse)
async def delete_me(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> DeleteMeResponse:
    result = await _svc(session).soft_delete_me(user_id=user.user.id)
    await session.commit()
    return result


@router.get("/{user_id}", response_model=ProfilePublic)
async def get_profile(
    user_id: int,
    viewer: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfilePublic:
    return await _svc(session).get_public_profile(target_user_id=user_id, viewer_id=viewer.user.id)
