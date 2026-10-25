"""Feed HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.feed.schemas import ExploreFeedPage, HomeFeedPage
from social_api.modules.feed.service import FeedService

router = APIRouter(prefix="/feed", tags=["feed"])


@router.get("/home", response_model=HomeFeedPage)
async def home_feed(
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> HomeFeedPage:
    return await FeedService(session).home(user_id=user.user.id, cursor=cursor, limit=limit)


@router.get("/explore", response_model=ExploreFeedPage)
async def explore_feed(
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ExploreFeedPage:
    return await FeedService(session).explore(viewer_id=user.user.id, cursor=cursor, limit=limit)
