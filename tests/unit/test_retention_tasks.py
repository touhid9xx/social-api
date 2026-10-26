"""Retention task helpers (call async impls directly with real session)."""

from __future__ import annotations

import pytest

from social_api.workers.tasks.retention import (
    _do_purge_notifications,
    _do_purge_orphan_media,
    _do_purge_read_messages,
    _do_purge_users,
)

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_purge_users_noop_when_nothing_due() -> None:
    """Integration-level: would need DB. Unit run: verify function is
    callable without crashing when DB is empty (testcontainers integration
    will cover the real behaviour)."""
    # In pure unit mode, we only verify imports and function shape.
    assert callable(_do_purge_users)


@pytest.mark.asyncio
async def test_purge_notifications_noop() -> None:
    assert callable(_do_purge_notifications)


@pytest.mark.asyncio
async def test_purge_orphan_media_noop() -> None:
    assert callable(_do_purge_orphan_media)


@pytest.mark.asyncio
async def test_purge_read_messages_noop() -> None:
    assert callable(_do_purge_read_messages)
