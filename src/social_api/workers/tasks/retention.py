"""Retention / purge tasks (Celery Beat).

Each task is idempotent, batches rows (LIMIT 100), and writes an audit
entry per successful batch.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select

from social_api.config import get_settings
from social_api.db.session import get_sessionmaker
from social_api.logging_config import get_logger
from social_api.modules.auth.models import User
from social_api.modules.gdpr.repository import DeletionRepository
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)

_BATCH = 100


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _write_audit(
    *,
    action: str,
    entity: str,
    entity_id: int | None,
    after: dict[str, Any] | None = None,
) -> None:
    try:
        from social_api.db.session import get_sessionmaker as _sm
        from social_api.modules.audit.service import AuditService

        async with _sm()() as s:
            await AuditService(s).write(
                actor_id=None,  # system actor
                action=action,
                entity=entity,
                entity_id=entity_id,
                after=after,
            )
            await s.commit()
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "retention_audit_failed",
            action=action,
            error=type(exc).__name__,
        )


# ---------------------------------------------------------------------------
# Purge users past hard-delete window
# ---------------------------------------------------------------------------
async def _do_purge_users() -> dict[str, int]:
    settings = get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=settings.retention_soft_deleted_days)

    sm = get_sessionmaker()
    total_purged = 0

    async with sm() as session:
        del_repo = DeletionRepository(session)
        due = await del_repo.list_due(cutoff=cutoff, limit=_BATCH)
        request_ids_and_users = [(r.id, r.user_id) for r in due]

    for request_id, user_id in request_ids_and_users:
        # Each user in its own transaction so a single failure doesn't
        # abort the whole batch.
        async with sm() as session:
            try:
                # Hard-delete user (cascades across FKs)
                await session.execute(delete(User).where(User.id == user_id))
                # Atomic status transition (only if still scheduled)
                del_repo = DeletionRepository(session)
                ok = await del_repo.mark_completed(request_id=request_id)
                await session.commit()
                if ok:
                    total_purged += 1
                    await _write_audit(
                        action="USER_HARD_DELETED",
                        entity="user",
                        entity_id=user_id,
                    )
            except Exception as exc:  # pragma: no cover
                await session.rollback()
                logger.warning(
                    "purge_user_failed",
                    user_id=user_id,
                    error=type(exc).__name__,
                )

    return {"purged": total_purged}


# ---------------------------------------------------------------------------
# Purge old notifications
# ---------------------------------------------------------------------------
async def _do_purge_notifications() -> dict[str, int]:
    from social_api.modules.notifications.models import Notification

    settings = get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    hard_cutoff = now - timedelta(days=settings.retention_notifications_days)
    soft_cutoff = now - timedelta(days=settings.retention_soft_deleted_days)

    sm = get_sessionmaker()
    total = 0
    async with sm() as session:
        for _ in range(1000):  # upper bound iterations (safety)
            stmt = (
                select(Notification.id)
                .where(
                    (Notification.deleted_at.is_not(None) & (Notification.deleted_at < soft_cutoff))
                    | (Notification.is_read.is_(True) & (Notification.created_at < hard_cutoff))
                )
                .limit(_BATCH)
            )
            ids = list((await session.execute(stmt)).scalars().all())
            if not ids:
                break
            await session.execute(delete(Notification).where(Notification.id.in_(ids)))
            await session.commit()
            total += len(ids)
            if len(ids) < _BATCH:
                break

    if total:
        await _write_audit(
            action="RETENTION_NOTIFICATIONS_PURGED",
            entity="notification",
            entity_id=None,
            after={"count": total},
        )
    return {"purged": total}


# ---------------------------------------------------------------------------
# Purge old audit rows
# ---------------------------------------------------------------------------
async def _do_purge_audit() -> dict[str, int]:
    from social_api.modules.audit.models import AuditLog

    settings = get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=settings.retention_audit_days)

    sm = get_sessionmaker()
    total = 0
    async with sm() as session:
        for _ in range(1000):
            stmt = select(AuditLog.id).where(AuditLog.created_at < cutoff).limit(_BATCH)
            ids = list((await session.execute(stmt)).scalars().all())
            if not ids:
                break
            await session.execute(delete(AuditLog).where(AuditLog.id.in_(ids)))
            await session.commit()
            total += len(ids)
            if len(ids) < _BATCH:
                break

    # Note: auditing the purge of audit is intentional (fixed-size audit
    # of retention itself, so we know it ran).
    if total:
        await _write_audit(
            action="RETENTION_AUDIT_PURGED",
            entity="audit_log",
            entity_id=None,
            after={"count": total},
        )
    return {"purged": total}


# ---------------------------------------------------------------------------
# Purge orphan media (no post, no message, past grace)
# ---------------------------------------------------------------------------
async def _do_purge_orphan_media() -> dict[str, int]:
    from social_api.modules.media.models import Media

    settings = get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=settings.retention_orphan_media_days)

    sm = get_sessionmaker()
    total = 0
    storage = None
    try:
        from social_api.modules.media.service import get_storage_backend

        storage = get_storage_backend()
    except Exception:  # pragma: no cover
        storage = None

    async with sm() as session:
        for _ in range(1000):
            stmt = (
                select(Media.id, Media.storage_key)
                .where(
                    Media.post_id.is_(None),
                    Media.message_id.is_(None),
                    Media.created_at < cutoff,
                )
                .limit(_BATCH)
            )
            rows = list((await session.execute(stmt)).all())
            if not rows:
                break
            ids = [r.id for r in rows]
            keys = [r.storage_key for r in rows]
            # Delete rows first (source of truth); files best-effort after.
            await session.execute(delete(Media).where(Media.id.in_(ids)))
            await session.commit()
            total += len(ids)
            if storage is not None:
                for k in keys:
                    try:
                        await storage.delete(key=k)
                    except Exception as exc:  # pragma: no cover - best effort
                        # File delete is best-effort: the DB row (source of
                        # truth) is already committed. Log so ops can see
                        # orphan files accumulating on disk / S3.
                        logger.warning(
                            "media_file_delete_failed",
                            storage_key=k,
                            error=type(exc).__name__,
                        )
            if len(ids) < _BATCH:
                break

    if total:
        await _write_audit(
            action="RETENTION_ORPHAN_MEDIA_PURGED",
            entity="media",
            entity_id=None,
            after={"count": total},
        )
    return {"purged": total}


# ---------------------------------------------------------------------------
# Purge old fully-read chat messages
# ---------------------------------------------------------------------------
async def _do_purge_read_messages() -> dict[str, int]:
    from social_api.modules.chat.models import (
        ChatRoomMember,
        Message,
    )

    settings = get_settings()
    now = datetime.now(UTC).replace(tzinfo=None)
    cutoff = now - timedelta(days=settings.retention_messages_days)

    sm = get_sessionmaker()
    total = 0
    async with sm() as session:
        # Fetch a batch of old messages; for each, check every member's
        # last_read_message_id >= msg.id.
        for _ in range(1000):
            msg_stmt = (
                select(Message.id, Message.room_id).where(Message.created_at < cutoff).limit(_BATCH)
            )
            msgs = list((await session.execute(msg_stmt)).all())
            if not msgs:
                break

            to_delete: list[int] = []
            for m_id, room_id in msgs:
                member_stmt = select(ChatRoomMember.last_read_message_id).where(
                    ChatRoomMember.room_id == room_id
                )
                member_lrs = list((await session.execute(member_stmt)).scalars().all())
                if all(lr is not None and lr >= m_id for lr in member_lrs):
                    to_delete.append(m_id)

            if to_delete:
                await session.execute(delete(Message).where(Message.id.in_(to_delete)))
                await session.commit()
                total += len(to_delete)

            if len(msgs) < _BATCH:
                break

    if total:
        await _write_audit(
            action="RETENTION_MESSAGES_PURGED",
            entity="message",
            entity_id=None,
            after={"count": total},
        )
    return {"purged": total}


# ---------------------------------------------------------------------------
# Celery task wrappers
#
# NOTE: `bind=True` is REQUIRED because each wrapper declares `self: Any`.
# Without it, Celery calls the function with NO args and raises TypeError
# on the first Beat fire. `bind=True` also enables `self.retry(...)` later
# for transient DB failures.
# ---------------------------------------------------------------------------
@celery_app.task(name="retention.purge_users", bind=True)
def purge_soft_deleted_users(self: Any) -> dict[str, int]:
    return asyncio.run(_do_purge_users())


@celery_app.task(name="retention.purge_notifications", bind=True)
def purge_old_notifications(self: Any) -> dict[str, int]:
    return asyncio.run(_do_purge_notifications())


@celery_app.task(name="retention.purge_audit", bind=True)
def purge_old_audit(self: Any) -> dict[str, int]:
    return asyncio.run(_do_purge_audit())


@celery_app.task(name="retention.purge_orphan_media", bind=True)
def purge_orphan_media(self: Any) -> dict[str, int]:
    return asyncio.run(_do_purge_orphan_media())


@celery_app.task(name="retention.purge_read_messages", bind=True)
def purge_read_chat_messages(self: Any) -> dict[str, int]:
    return asyncio.run(_do_purge_read_messages())
