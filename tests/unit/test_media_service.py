"""Media service with in-memory storage + fake repo."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from social_api.modules.auth.models import User, UserRole
from social_api.modules.media.models import Media, MediaKind
from social_api.modules.media.service import MediaService

pytestmark = pytest.mark.unit

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63000100000005000100"
    "0d0a2db40000000049454e44ae426082"
)


class _FakeRepo:
    def __init__(self) -> None:
        self.by_sha: dict[tuple[int, str], Media] = {}
        self.by_id: dict[int, Media] = {}
        self._next_id = 1

    async def get_by_owner_and_sha(self, *, owner_id: int, sha256: str) -> Media | None:
        return self.by_sha.get((owner_id, sha256))

    async def get_by_id(self, media_id: int) -> Media | None:
        return self.by_id.get(media_id)

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
        m = Media(
            id=self._next_id,
            owner_id=owner_id,
            post_id=None,
            sha256=sha256,
            mime=mime,
            kind=MediaKind(kind),
            size_bytes=size_bytes,
            storage_key=storage_key,
            original_name=original_name,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            deleted_at=None,
            version=1,
        )
        self._next_id += 1
        self.by_sha[(owner_id, sha256)] = m
        self.by_id[m.id] = m
        return m

    async def save(self, m: Media) -> None:
        pass


class _FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, *, key: str, data: bytes, content_type: str) -> Any:
        from social_api.media.storage import StoredObject

        self.objects[key] = data
        return StoredObject(key=key, size_bytes=len(data), url=f"mem://{key}")

    async def delete(self, *, key: str) -> None:
        self.objects.pop(key, None)

    async def url_for(self, *, key: str) -> str:
        return f"mem://{key}"


def _user(uid: int = 1) -> User:
    u = User(
        id=uid,
        email="x@example.com",
        email_hash="h",
        password_hash="x",
        role=UserRole.USER,
        is_active=True,
        is_verified=False,
    )
    u.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    return u


@pytest.mark.asyncio
async def test_upload_creates_row() -> None:
    svc = MediaService(session=None, storage=_FakeStorage())  # type: ignore[arg-type]
    svc._repo = _FakeRepo()  # type: ignore[assignment]

    v = await svc.upload(owner_id=1, data=PNG_BYTES, original_name="a.png")
    assert v.kind == "image"
    assert v.size_bytes == len(PNG_BYTES)


@pytest.mark.asyncio
async def test_upload_dedup() -> None:
    storage = _FakeStorage()
    svc = MediaService(session=None, storage=storage)  # type: ignore[arg-type]
    svc._repo = _FakeRepo()  # type: ignore[assignment]

    v1 = await svc.upload(owner_id=1, data=PNG_BYTES, original_name="a.png")
    v2 = await svc.upload(owner_id=1, data=PNG_BYTES, original_name="b.png")
    assert v1.id == v2.id
    assert len(storage.objects) == 1


@pytest.mark.asyncio
async def test_dedup_isolated_per_owner() -> None:
    storage = _FakeStorage()
    svc = MediaService(session=None, storage=storage)  # type: ignore[arg-type]
    svc._repo = _FakeRepo()  # type: ignore[assignment]

    v1 = await svc.upload(owner_id=1, data=PNG_BYTES, original_name="a.png")
    v2 = await svc.upload(owner_id=2, data=PNG_BYTES, original_name="a.png")
    assert v1.id != v2.id
    # same bytes -> 2 storage keys (per owner)
    assert len(storage.objects) == 2
