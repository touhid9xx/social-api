"""Audit HTTP endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user, require_roles
from social_api.modules.audit.schemas import AuditPage
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import UserRole

router = APIRouter(prefix="/audit", tags=["audit"])

# Closed set of filterable values — mirrors the actual strings the
# AuditService.write() call sites emit (grep: 'action="<NAME>"').
# Anything else is rejected by FastAPI with 422 before reaching the
# service layer — no typo 500s, no injection-shaped strings, and the
# OpenAPI schema surfaces the full enum for frontend codegen.
AuditActionLiteral = Literal[
    "REGISTER",  # auth
    "LOGIN",  # auth
    "LOGOUT",  # auth
    "PROFILE_UPDATE",  # users/profile
    "DELETE_POST",  # posts
    "DELETE_COMMENT",  # comments
    "BLOCK",  # follows/block
    "UNBLOCK",  # follows/block
    "MUTE",  # follows/mute
    "UNMUTE",  # follows/mute
    "CREATE_CHAT_GROUP",  # chat
    "UPDATE_CHAT_GROUP_TITLE",  # chat
    "ADD_CHAT_MEMBER",  # chat
    "REMOVE_CHAT_MEMBER",  # chat
    "DELETE_CHAT_MESSAGE",  # chat
    "MODERATION_STATUS_UPDATE",  # moderation
]

AuditEntityLiteral = Literal[
    "user",
    "profile",
    "post",
    "comment",
    "message",
    "chat_room",
    "report",
]


@router.get("/me", response_model=AuditPage)
async def my_audit(
    action: AuditActionLiteral | None = Query(default=None),
    entity: AuditEntityLiteral | None = Query(default=None),
    entity_id: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> AuditPage:
    """Caller's own audit trail.

    Users can see what actions they've taken (register, login, post,
    report, etc.). Useful for GDPR data-portability requests (M19) and
    as a "recent activity" feed.
    """
    return await AuditService(session).list_logs(
        actor_id=user.user.id,
        action_filter=action,
        entity_filter=entity,
        entity_id_filter=entity_id,
        cursor=cursor,
        limit=limit,
    )


# NOTE: empty-string route "" — NOT "/".
# With prefix="/audit", "" resolves to GET /api/v1/audit (direct match).
# A "/" here would resolve to /api/v1/audit/ and cause FastAPI's default
# redirect_slashes to return a 307 on GET /api/v1/audit. httpx clients
# don't follow redirects by default — the 307 would surface as the final
# response.
@router.get("", response_model=AuditPage)
async def list_all_audit(
    actor_id: int | None = Query(default=None),
    action: AuditActionLiteral | None = Query(default=None),
    entity: AuditEntityLiteral | None = Query(default=None),
    entity_id: int | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> AuditPage:
    """Admin-only: full audit log across all users.

    `_admin` is deliberately unused in the body — it's the RBAC gate.
    The dependency raises 403 before the handler runs for non-admins.
    """
    return await AuditService(session).list_logs(
        actor_id=actor_id,
        action_filter=action,
        entity_filter=entity,
        entity_id_filter=entity_id,
        cursor=cursor,
        limit=limit,
    )
