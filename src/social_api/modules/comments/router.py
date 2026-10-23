"""Comments HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.comments.schemas import (
    CommentCreate,
    CommentPage,
    CommentUpdate,
    CommentView,
)
from social_api.modules.comments.service import CommentsService

router = APIRouter(tags=["comments"])


def _svc(session: AsyncSession) -> CommentsService:
    return CommentsService(session)


@router.post(
    "/posts/{post_id}/comments",
    response_model=CommentView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute", key_func=_key_by_user_or_ip)
async def create_comment(
    post_id: int,
    request: Request,
    response: Response,
    payload: CommentCreate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CommentView:
    result = await _svc(session).create(viewer_id=user.user.id, post_id=post_id, payload=payload)
    await session.commit()
    return result


@router.get("/posts/{post_id}/comments", response_model=CommentPage)
async def list_comments(
    post_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CommentPage:
    return await _svc(session).list_for_post(
        viewer_id=user.user.id, post_id=post_id, cursor=cursor, limit=limit
    )


@router.patch("/comments/{comment_id}", response_model=CommentView)
async def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> CommentView:
    return await _svc(session).update(
        viewer_id=user.user.id, comment_id=comment_id, payload=payload
    )


@router.delete(
    "/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_comment(
    comment_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).delete(actor=user.user, comment_id=comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
