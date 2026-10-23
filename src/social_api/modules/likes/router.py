"""Likes HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.likes.schemas import LikeUserPage
from social_api.modules.likes.service import LikesService

router = APIRouter(tags=["likes"])


def _svc(session: AsyncSession) -> LikesService:
    return LikesService(session)


@router.post(
    "/likes/{target_type}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def like(
    target_type: str,
    target_id: int,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    if target_type not in {"post", "comment"}:
        from social_api.exceptions import BadRequestError

        raise BadRequestError("target_type must be post or comment")
    await _svc(session).like(user_id=user.user.id, target_type=target_type, target_id=target_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/likes/{target_type}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def unlike(
    target_type: str,
    target_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).unlike(user_id=user.user.id, target_type=target_type, target_id=target_id)
    await session.commit()  # ← ADD THIS (was missing)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/likes/{target_type}/{target_id}/users",
    response_model=LikeUserPage,
)
async def list_likers(
    target_type: str,
    target_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> LikeUserPage:
    return await _svc(session).list_likers(
        target_type=target_type,
        target_id=target_id,
        cursor=cursor,
        limit=limit,
    )
