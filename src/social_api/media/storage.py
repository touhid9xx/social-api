"""StorageBackend Protocol + shared types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class StoredObject:
    """Result of a storage put."""

    key: str  # opaque path/key (used for retrieval)
    size_bytes: int
    url: str  # public URL or presigned URL (backend-specific)


@dataclass(frozen=True)
class StorageConfig:
    root: str  # local: directory; s3: bucket
    prefix: str  # sub-folder or s3 key prefix


class StorageBackend(Protocol):
    """
    Pluggable storage interface.

    Implementations MUST be safe to call concurrently.
    `put` is idempotent for the same key (overwrite allowed).
    """

    async def put(self, *, key: str, data: bytes, content_type: str) -> StoredObject: ...

    async def delete(self, *, key: str) -> None: ...

    async def url_for(self, *, key: str) -> str:
        """Return a public URL (local) or presigned (S3)."""
        ...
