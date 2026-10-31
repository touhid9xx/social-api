"""Media service — upload, attach-to-post, soft-delete."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.config import get_settings
from social_api.logging_config import get_logger
from social_api.media.storage import StorageBackend
from social_api.media.validators import (
    FileTooLargeError,
    UnsupportedFileTypeError,
    validate_file,
)
from social_api.modules.auth.models import User
from social_api.modules.media.exceptions import (
    MediaAlreadyAttachedError,
    MediaForbiddenError,
    MediaNotFoundError,
    MediaTooLargeError,
    UnsupportedMediaTypeError,
)
from social_api.modules.media.models import Media
from social_api.modules.media.repository import MediaRepository
from social_api.modules.media.schemas import MediaView
from social_api.modules.posts.repository import PostsRepository

logger = get_logger(__name__)

_READ_CHUNK: Final[int] = 1024 * 1024


def _to_view(media: Media, *, url: str) -> MediaView:
    return MediaView(
        id=media.id,
        owner_id=media.owner_id,
        post_id=media.post_id,
        kind=media.kind.value,
        mime=media.mime,
        size_bytes=media.size_bytes,
        url=url,
        created_at=media.created_at,
    )


async def media_by_post(
    repo: MediaRepository,
    storage: StorageBackend,
    *,
    post_ids: Sequence[int],
) -> dict[int, list[MediaView]]:
    """Group a page's attached, live media by post id.

    One SELECT plus one URL resolution per row — feed pagination must not
    turn into N+1. Posts without media are simply absent from the mapping,
    so callers use `result.get(post_id, [])`.

    Takes the repository (not a session) so read services can hold their own
    instance and unit tests can swap in a fake, like every other repo here.
    """
    if not post_ids:
        return {}
    rows = await repo.list_by_post_ids(post_ids=post_ids)
    grouped: dict[int, list[MediaView]] = {}
    for media in rows:
        if media.post_id is None:  # defensive: the query already filters this
            continue
        url = await storage.url_for(key=media.storage_key)
        grouped.setdefault(media.post_id, []).append(_to_view(media, url=url))
    return grouped


class MediaService:
    def __init__(self, session: AsyncSession, storage: StorageBackend) -> None:
        self._s = session
        self._repo = MediaRepository(session)
        self._posts = PostsRepository(session)
        self._storage = storage

    # ---- Upload ----
    async def upload(
        self,
        *,
        owner_id: int,
        data: bytes,
        original_name: str | None,
        declared_content_type: str | None = None,
    ) -> MediaView:
        # Validate via magic bytes (never trust client extension/header).
        try:
            v = validate_file(data=data, declared_content_type=declared_content_type)
        except UnsupportedFileTypeError as exc:
            raise UnsupportedMediaTypeError(str(exc)) from exc
        except FileTooLargeError as exc:
            raise MediaTooLargeError(str(exc)) from exc

        # Idempotency: same (owner_id, sha256) returns existing row.
        sha = hashlib.sha256(data).hexdigest()
        existing = await self._repo.get_by_owner_and_sha(owner_id=owner_id, sha256=sha)
        if existing is not None:
            url = await self._storage.url_for(key=existing.storage_key)
            logger.debug("media_upload_dedup", media_id=existing.id, sha=sha)
            return _to_view(existing, url=url)

        # Store bytes under {owner_id}/{sha256}.{ext}
        storage_key = f"{owner_id}/{sha}.{v.ext}"
        await self._storage.put(key=storage_key, data=data, content_type=v.mime)

        # Persist row
        media = await self._repo.create(
            owner_id=owner_id,
            sha256=sha,
            mime=v.mime,
            kind=v.kind,
            size_bytes=len(data),
            storage_key=storage_key,
            original_name=(original_name or "")[:255] or None,
        )
        url = await self._storage.url_for(key=media.storage_key)
        logger.info(
            "media_uploaded",
            media_id=media.id,
            owner_id=owner_id,
            kind=v.kind,
            size=len(data),
        )
        return _to_view(media, url=url)

    # ---- Read ----
    async def get(self, *, media_id: int) -> MediaView:
        media = await self._repo.get_by_id(media_id)
        if media is None:
            raise MediaNotFoundError()
        url = await self._storage.url_for(key=media.storage_key)
        return _to_view(media, url=url)

    # ---- Attach to post ----
    async def attach_to_post(self, *, actor: User, media_id: int, post_id: int) -> MediaView:
        media = await self._repo.get_by_id(media_id)
        if media is None:
            raise MediaNotFoundError()
        if media.owner_id != actor.id:
            raise MediaForbiddenError()

        post = await self._posts.get_by_id(post_id)
        if post is None:
            from social_api.modules.posts.exceptions import PostNotFoundError

            raise PostNotFoundError()
        if post.author_id != actor.id:
            from social_api.modules.posts.exceptions import PostForbiddenError

            raise PostForbiddenError()

        # Media can only be attached once.
        if media.post_id is not None and media.post_id != post_id:
            raise MediaAlreadyAttachedError()

        if media.post_id is None:
            media.post_id = post_id
            post.media_count += 1
            await self._repo.save(media)
            await self._posts.save(post)
            logger.info(
                "media_attached",
                media_id=media.id,
                post_id=post_id,
                actor_id=actor.id,
            )

        url = await self._storage.url_for(key=media.storage_key)
        return _to_view(media, url=url)

    # ---- Soft-delete ----
    async def delete(self, *, actor: User, media_id: int) -> None:
        media = await self._repo.get_by_id(media_id)
        if media is None:
            raise MediaNotFoundError()
        if media.owner_id != actor.id:
            from social_api.modules.auth.models import UserRole

            if actor.role not in (UserRole.MODERATOR, UserRole.ADMIN):
                raise MediaForbiddenError()

        media.deleted_at = datetime.now(UTC).replace(tzinfo=None)
        await self._repo.save(media)
        logger.info("media_soft_deleted", media_id=media_id, actor_id=actor.id)
        # Physical delete via Celery retention job (M19).


def get_storage_backend() -> StorageBackend:
    """
    Factory: pick backend based on settings.

    MEDIA_BACKEND env: "local" (default) | "s3".
    """
    settings = get_settings()
    backend = getattr(settings, "media_backend", "local")
    if backend == "s3":
        from social_api.media.s3 import S3Storage

        bucket = getattr(settings, "s3_bucket", "")
        region = getattr(settings, "s3_region", "us-east-1")
        if not bucket:
            raise RuntimeError("MEDIA_BACKEND=s3 requires S3_BUCKET env var")
        return S3Storage(bucket=bucket, region=region)

    from social_api.media.local import LocalStorage

    return LocalStorage(
        root=settings.media_root,
        base_url="/static/media",
    )
