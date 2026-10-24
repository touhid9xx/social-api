"""LocalStorage path safety + put/get/delete."""

from __future__ import annotations

from pathlib import Path

import pytest

from social_api.media.local import LocalStorage

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_put_get_delete(tmp_path: Path) -> None:
    storage = LocalStorage(root=str(tmp_path), base_url="/static/media")
    obj = await storage.put(key="42/abc.png", data=b"\x89PNG", content_type="image/png")
    assert obj.size_bytes == 4
    assert obj.url == "/static/media/42/abc.png"
    # On disk
    assert (tmp_path / "42" / "abc.png").read_bytes() == b"\x89PNG"

    await storage.delete(key="42/abc.png")
    assert not (tmp_path / "42" / "abc.png").exists()


@pytest.mark.asyncio
async def test_delete_missing_is_idempotent(tmp_path: Path) -> None:
    storage = LocalStorage(root=str(tmp_path))
    await storage.delete(key="does/not/exist")


@pytest.mark.asyncio
async def test_path_traversal_blocked(tmp_path: Path) -> None:
    storage = LocalStorage(root=str(tmp_path))
    with pytest.raises(ValueError, match="Path traversal blocked"):
        await storage.put(key="../../etc/passwd", data=b"x", content_type="text/plain")
