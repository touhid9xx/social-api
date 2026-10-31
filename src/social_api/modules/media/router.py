"""Media HTTP endpoints."""

from __future__ import annotations

from fastapi import (
    APIRouter,
    Depends,
    File,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.media.storage import StorageBackend
from social_api.modules.media.schemas import MediaView
from social_api.modules.media.service import MediaService, get_storage_backend

router = APIRouter(prefix="/media", tags=["media"])


def _svc(session: AsyncSession, storage: StorageBackend) -> MediaService:
    return MediaService(session, storage)


@router.post(
    "",
    response_model=MediaView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute", key_func=_key_by_user_or_ip)
async def upload_media(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> MediaView:
    data = await file.read()
    result = await _svc(session, storage).upload(
        owner_id=user.user.id,
        data=data,
        original_name=file.filename,
        declared_content_type=file.content_type,
    )
    await session.commit()
    return result


@router.get("/{media_id}", response_model=MediaView)
async def get_media(
    media_id: int,
    _user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> MediaView:
    return await _svc(session, storage).get(media_id=media_id)


@router.post(
    "/{media_id}/attach/{post_id}",
    response_model=MediaView,
)
async def attach_to_post(
    media_id: int,
    post_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> MediaView:
    result = await _svc(session, storage).attach_to_post(
        actor=user.user, media_id=media_id, post_id=post_id
    )
    await session.commit()
    return result


@router.post(
    "/{media_id}/avatar",
    response_model=MediaView,
)
async def set_avatar(
    media_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> MediaView:
    """Promote an uploaded image to the caller's profile picture."""
    result = await _svc(session, storage).set_avatar(actor=user.user, media_id=media_id)
    await session.commit()
    return result


@router.delete(
    "/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_media(
    media_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    storage: StorageBackend = Depends(get_storage_backend),
) -> Response:
    await _svc(session, storage).delete(actor=user.user, media_id=media_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
