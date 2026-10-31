"""Posts HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.media.storage import StorageBackend
from social_api.modules.media.service import get_storage_backend
from social_api.modules.posts.schemas import (
    PostCreate,
    PostPage,
    PostUpdate,
    PostView,
)
from social_api.modules.posts.service import PostsService

router = APIRouter(prefix="/posts", tags=["posts"])


def _svc(session: AsyncSession, storage: StorageBackend | None = None) -> PostsService:
    # `storage` is only needed to resolve media URLs on read paths; the
    # write endpoints leave it None so they never construct a backend.
    return PostsService(session, storage)


@router.post(
    "",
    response_model=PostView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute", key_func=_key_by_user_or_ip)
async def create_post(
    request: Request,
    response: Response,
    payload: PostCreate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> PostView:
    result = await _svc(session).create(author_id=user.user.id, payload=payload)
    await session.commit()
    return result


@router.get("/{post_id}", response_model=PostView)
async def get_post(
    post_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> PostView:
    return await _svc(session, storage).get(viewer_id=user.user.id, post_id=post_id)


@router.patch("/{post_id}", response_model=PostView)
async def update_post(
    post_id: int,
    payload: PostUpdate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> PostView:
    return await _svc(session, storage).update(
        viewer_id=user.user.id, post_id=post_id, payload=payload
    )


@router.delete(
    "/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_post(
    post_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).delete(actor=user.user, post_id=post_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/by-author/{author_id}",
    response_model=PostPage,
)
async def list_by_author(
    author_id: int,
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> PostPage:
    return await _svc(session, storage).list_by_author(
        viewer_id=user.user.id,
        author_id=author_id,
        cursor=cursor,
        limit=limit,
    )
