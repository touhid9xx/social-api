"""Follows HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.follows.schemas import (
    FollowCounts,
    FollowListPage,
    FollowStatus,
)
from social_api.modules.follows.service import FollowsService

router = APIRouter(tags=["follows"])


def _svc(session: AsyncSession) -> FollowsService:
    return FollowsService(session)


# ---- Follow / Unfollow ----
@router.post(
    "/follows/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Follow a user (idempotent)",
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def follow(
    user_id: int,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).follow(follower_id=user.user.id, followee_id=user_id)
    await session.commit()  # commit before response
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/follows/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Unfollow a user (idempotent)",
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def unfollow(
    user_id: int,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).unfollow(follower_id=user.user.id, followee_id=user_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/{user_id}/followers", response_model=FollowListPage)
async def followers(
    user_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _viewer: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FollowListPage:
    return await _svc(session).list_followers(user_id=user_id, cursor=cursor, limit=limit)


@router.get("/users/{user_id}/following", response_model=FollowListPage)
async def following(
    user_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _viewer: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FollowListPage:
    return await _svc(session).list_following(user_id=user_id, cursor=cursor, limit=limit)


@router.get("/users/{user_id}/follow-status", response_model=FollowStatus)
async def status_endpoint(
    user_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FollowStatus:
    return await _svc(session).status(viewer_id=user.user.id, target_id=user_id)


@router.get("/users/{user_id}/follow-counts", response_model=FollowCounts)
async def counts(
    user_id: int,
    _viewer: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FollowCounts:
    return await _svc(session).counts(user_id=user_id)


# ---- Block ----
@router.post(
    "/blocks/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def block(
    user_id: int,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).block(blocker_id=user.user.id, blocked_id=user_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/blocks/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def unblock(
    user_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).unblock(blocker_id=user.user.id, blocked_id=user_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- Mute ----
@router.post(
    "/mutes/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def mute(
    user_id: int,
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).mute(muter_id=user.user.id, muted_id=user_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/mutes/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def unmute(
    user_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).unmute(muter_id=user.user.id, muted_id=user_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
