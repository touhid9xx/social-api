"""Local filesystem storage backend."""

from __future__ import annotations

from pathlib import Path

import anyio

from social_api.logging_config import get_logger
from social_api.media.storage import StoredObject

logger = get_logger(__name__)


class LocalStorage:
    """Local filesystem storage under a root directory."""

    def __init__(self, *, root: str, base_url: str = "/static/media") -> None:
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._base_url = base_url.rstrip("/")

    def _full_path(self, key: str) -> Path:
        # Prevent path traversal: reject keys escaping root.
        p = (self._root / key).resolve()
        if not str(p).startswith(str(self._root)):
            raise ValueError(f"Path traversal blocked for key: {key}")
        return p

    async def put(self, *, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._full_path(key)
        await anyio.to_thread.run_sync(lambda: path.parent.mkdir(parents=True, exist_ok=True))
        await anyio.to_thread.run_sync(path.write_bytes, data)
        logger.debug("storage_put_local", key=key, size=len(data), content_type=content_type)
        return StoredObject(key=key, size_bytes=len(data), url=await self.url_for(key=key))

    async def delete(self, *, key: str) -> None:
        path = self._full_path(key)
        try:
            await anyio.to_thread.run_sync(path.unlink)
        except FileNotFoundError:
            return
        except Exception:
            logger.warning("storage_delete_failed", key=key)
            return

    async def url_for(self, *, key: str) -> str:
        return f"{self._base_url}/{key.lstrip('/')}"
