"""GDPR service: export, deletion scheduling, cancellation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.config import get_settings
from social_api.logging_config import get_logger
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import User
from social_api.modules.auth.repository import UserRepository
from social_api.modules.gdpr.exceptions import (
    AlreadyScheduledForDeletionError,
    NoActiveDeletionError,
)
from social_api.modules.gdpr.models import DeletionRequest
from social_api.modules.gdpr.repository import (
    DeletionRepository,
    ExportRepository,
)
from social_api.modules.gdpr.schemas import (
    CancelResponse,
    DeletionStatusView,
    ExportPayload,
)
from social_api.modules.users.exceptions import ProfileNotFoundError
from social_api.modules.users.repository import ProfileRepository

logger = get_logger(__name__)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=UTC).isoformat()


class GdprService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._users = UserRepository(session)
        self._profiles = ProfileRepository(session)
        self._del = DeletionRepository(session)
        self._exp = ExportRepository(session)

    async def _audit(
        self,
        *,
        actor_id: int,
        action: str,
        after: dict[str, object] | None = None,
    ) -> None:
        """Best-effort audit write. Never fails the caller."""
        try:
            await AuditService(self._s).write(
                actor_id=actor_id,
                action=action,
                entity="user",
                entity_id=actor_id,
                after=after,
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "audit_write_failed",
                action=action,
                user_id=actor_id,
                error=type(exc).__name__,
            )

    async def _get_user_or_404(self, user_id: int) -> User:
        """Load a user for GDPR flows — including soft-deleted.

        GDPR endpoints operate during the 30-day grace window (cancel,
        status) where the user row is soft-deleted but must still be
        readable. The strict get_by_id would return None and 404 every
        cancel/status call after DELETE /me.

        Export is the exception: it must refuse a deleted user, and it
        enforces that explicitly in export() below. Every other caller
        wants the row regardless of deleted_at.
        """
        user = await self._users.get_by_id_including_deleted(user_id)
        if user is None:
            raise ProfileNotFoundError()
        return user

    # ---- Export ----
    async def export(self, *, user_id: int) -> ExportPayload:
        user = await self._get_user_or_404(user_id)

        # Defense in depth: /gdpr/export uses get_current_user (strict),
        # so a deleted user never reaches here via HTTP. But if this is
        # ever called from a background job or future route, refusing
        # is the correct behavior (spec: cannot export after soft-delete).
        if user.deleted_at is not None or not user.is_active:
            raise ProfileNotFoundError()

        user_payload: dict[str, Any] = {
            "id": user.id,
            "role": user.role.value,
            "is_active": user.is_active,
            "is_verified": user.is_verified,
            "created_at": _iso(user.created_at),
            "updated_at": _iso(user.updated_at),
            "deleted_at": _iso(user.deleted_at),
            # Own PII (decrypted) — only served to the owner here
            "email": user.email,
        }

        profile = await self._exp.get_profile(user.id)
        profile_payload: dict[str, Any] | None = None
        if profile is not None:
            profile_payload = {
                "display_name": profile.display_name,
                "bio": profile.bio,
                "avatar_url": profile.avatar_url,
                "location": profile.location,
                "website": profile.website,
                "visibility": profile.visibility.value,
                "pii_visibility": profile.pii_visibility.value,
                "dob": profile.dob,
                "phone": profile.phone,
                "address": profile.address,
                "created_at": _iso(profile.created_at),
                "updated_at": _iso(profile.updated_at),
            }

        consents = await self._exp.list_consents(user.id)
        consents_payload = [
            {
                "channel": c.channel.value,
                "granted": c.granted,
                "granted_at": _iso(c.granted_at),
                "revoked_at": _iso(c.revoked_at),
                "created_at": _iso(c.created_at),
            }
            for c in consents
        ]

        posts = await self._exp.list_posts(user.id)
        posts_payload = [
            {
                "id": p.id,
                "body": p.body,
                "visibility": p.visibility.value,
                "like_count": p.like_count,
                "comment_count": p.comment_count,
                "media_count": p.media_count,
                "created_at": _iso(p.created_at),
                "updated_at": _iso(p.updated_at),
                "deleted_at": _iso(p.deleted_at),
            }
            for p in posts
        ]

        comments = await self._exp.list_comments(user.id)
        comments_payload = [
            {
                "id": c.id,
                "post_id": c.post_id,
                "parent_id": c.parent_id,
                "body": c.body,
                "depth": c.depth,
                "created_at": _iso(c.created_at),
                "deleted_at": _iso(c.deleted_at),
            }
            for c in comments
        ]

        likes = await self._exp.list_likes(user.id)
        likes_payload = [
            {
                "target_type": lk.target_type.value,
                "target_id": lk.target_id,
                "created_at": _iso(lk.created_at),
            }
            for lk in likes
        ]

        following, followers = await self._exp.list_follows(user.id)
        follows_payload = {
            "following": following,
            "followers": followers,
        }

        blocks = await self._exp.list_blocks(user.id)
        mutes = await self._exp.list_mutes(user.id)

        rooms = await self._exp.list_chat_rooms(user.id)
        rooms_payload: list[dict[str, Any]] = []
        for room in rooms:
            msgs = await self._exp.list_messages_in_room(room.id)
            rooms_payload.append(
                {
                    "room": {
                        "id": room.id,
                        "type": room.type.value,
                        "title": room.title,
                        "created_at": _iso(room.created_at),
                    },
                    "messages": [
                        {
                            "id": m.id,
                            "sender_id": m.sender_id,
                            "body": m.body,
                            "media_id": m.media_id,
                            "created_at": _iso(m.created_at),
                            "deleted_at": _iso(m.deleted_at),
                        }
                        for m in msgs
                    ],
                }
            )

        notifs = await self._exp.list_notifications(user.id)
        notifs_payload = [
            {
                "id": n.id,
                "type": n.type.value,
                "actor_id": n.actor_id,
                "target_type": n.target_type.value,
                "target_id": n.target_id,
                "is_read": n.is_read,
                "read_at": _iso(n.read_at),
                "preview": n.preview,
                "created_at": _iso(n.created_at),
            }
            for n in notifs
        ]

        reports = await self._exp.list_reports_made(user.id)
        reports_payload = [
            {
                "id": r.id,
                "target_type": r.target_type.value,
                "target_id": r.target_id,
                "reason": r.reason.value,
                "status": r.status.value,
                "created_at": _iso(r.created_at),
                "resolved_at": _iso(r.resolved_at),
            }
            for r in reports
        ]

        logger.info("gdpr_export_generated", user_id=user.id)
        return ExportPayload(
            exported_at=datetime.now(UTC),
            user=user_payload,
            profile=profile_payload,
            consents=consents_payload,
            posts=posts_payload,
            comments=comments_payload,
            likes=likes_payload,
            follows=follows_payload,
            blocks=blocks,
            mutes=mutes,
            chat_rooms=rooms_payload,
            notifications=notifs_payload,
            reports_made=reports_payload,
        )

    # ---- Deletion ----
    async def schedule_deletion(self, *, user: User) -> DeletionRequest:
        """Create a deletion_requests row for an already-loaded user.

        Takes a User (not user_id) deliberately. The caller is
        DELETE /users/me, which:
          1. loads the user via get_current_user (strict, no deleted),
          2. calls soft_delete_me() — sets deleted_at + is_active=0,
          3. calls this with the SAME User object.
        If we took a user_id and re-fetched, the row would already be
        soft-deleted and the strict get_by_id would 404 — which is
        exactly the bug that broke M19 integration tests. Loading once
        and reusing also keeps soft-delete + schedule_deletion atomic
        in a single transaction (both succeed, or neither commits).
        """
        existing = await self._del.get_active_for_user(user.id)
        if existing is not None:
            raise AlreadyScheduledForDeletionError()

        settings = get_settings()
        now = datetime.now(UTC).replace(tzinfo=None)
        days = getattr(settings, "gdpr_deletion_window_days", 30)
        scheduled_at = now + timedelta(days=days)
        row = await self._del.create(user_id=user.id, scheduled_hard_delete_at=scheduled_at)
        logger.info(
            "gdpr_deletion_scheduled",
            user_id=user.id,
            scheduled_hard_delete_at=scheduled_at.isoformat(),
        )

        await self._audit(
            actor_id=user.id,
            action="GDPR_DELETE_SCHEDULED",
            after={"scheduled_hard_delete_at": scheduled_at.isoformat()},
        )
        return row

    async def cancel_deletion(self, *, user_id: int) -> CancelResponse:
        # _get_user_or_404 loads including_deleted — the user IS
        # soft-deleted at this point (that's why they're cancelling).
        user = await self._get_user_or_404(user_id)

        row = await self._del.get_active_for_user(user.id)
        if row is None:
            raise NoActiveDeletionError()

        await self._del.cancel(row)

        # Restore the user AND the profile — soft_delete_me set both
        # deleted_at, so cancel must reverse both.
        user.deleted_at = None
        user.is_active = True

        profile = await self._profiles.get_by_user_id_including_deleted(user.id)
        if profile is not None:
            profile.deleted_at = None

        await self._s.flush()

        logger.info("gdpr_deletion_cancelled", user_id=user.id)

        await self._audit(
            actor_id=user.id,
            action="GDPR_DELETE_CANCELLED",
        )
        return CancelResponse(message="Account restored")

    async def deletion_status(self, *, user_id: int) -> DeletionStatusView:
        # _get_user_or_404 loads including_deleted — a soft-deleted user
        # is exactly the case this endpoint serves.
        user = await self._get_user_or_404(user_id)
        row = await self._del.get_active_for_user(user.id)
        if row is None:
            return DeletionStatusView(
                scheduled=False,
                scheduled_hard_delete_at=None,
                status="none",
            )
        return DeletionStatusView(
            scheduled=True,
            scheduled_hard_delete_at=row.scheduled_hard_delete_at,
            status=row.status.value,
        )
