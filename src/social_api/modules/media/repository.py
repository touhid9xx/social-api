"""Media repository."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.media.models import Media


class MediaRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get_by_id(self, media_id: int) -> Media | None:
        stmt = select(Media).where(Media.id == media_id, Media.deleted_at.is_(None))
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def get_by_owner_and_sha(self, *, owner_id: int, sha256: str) -> Media | None:
        stmt = select(Media).where(
            Media.owner_id == owner_id,
            Media.sha256 == sha256,
            Media.deleted_at.is_(None),
        )
        res = await self._s.execute(stmt)
        return res.scalar_one_or_none()

    async def create(
        self,
        *,
        owner_id: int,
        sha256: str,
        mime: str,
        kind: str,
        size_bytes: int,
        storage_key: str,
        original_name: str | None,
    ) -> Media:
        from social_api.modules.media.models import MediaKind

        m = Media(
            owner_id=owner_id,
            sha256=sha256,
            mime=mime,
            kind=MediaKind(kind),
            size_bytes=size_bytes,
            storage_key=storage_key,
            original_name=original_name,
        )
        self._s.add(m)
        await self._s.flush()
        await self._s.refresh(m)
        return m

    async def save(self, m: Media) -> None:
        await self._s.flush()
