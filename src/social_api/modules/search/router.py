"""Search HTTP endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.search.schemas import SearchResults
from social_api.modules.search.service import SearchService

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchResults)
@limiter.limit("30/minute", key_func=_key_by_user_or_ip)
async def search(
    request: Request,
    q: str = Query(min_length=1, max_length=100),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SearchResults:
    """Search people and posts. Read-only — no commit.

    `q` is trimmed by the service, which enforces the real 2-character floor
    (`QUERY_TOO_SHORT`); the `min_length=1` here only stops an empty string
    from reaching it.
    """
    return await SearchService(session).search(
        viewer_id=user.user.id,
        query=q,
        cursor=cursor,
        limit=limit,
    )
