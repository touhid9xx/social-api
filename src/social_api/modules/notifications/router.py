"""Notifications HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user
from social_api.modules.notifications.schemas import (
    MarkReadResponse,
    NotificationPage,
    NotificationScopeLiteral,
    NotificationView,
    UnreadCount,
)
from social_api.modules.notifications.service import NotificationsService

router = APIRouter(prefix="/notifications", tags=["notifications"])

_SCOPE_DOC = (
    "Which slice of the inbox to act on: `all` (default), `social` "
    "(person-to-person activity: follows, likes, comments) or `system` "
    "(staff traffic such as `admin_new_user`)."
)


def _svc(session: AsyncSession) -> NotificationsService:
    return NotificationsService(session)


@router.get("", response_model=NotificationPage)
@limiter.limit("60/minute", key_func=_key_by_user_or_ip)
async def list_notifications(
    request: Request,
    response: Response,
    unread_only: bool = Query(default=False),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=50),
    scope: NotificationScopeLiteral = Query(default="all", description=_SCOPE_DOC),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> NotificationPage:
    result = await _svc(session).list_inbox(
        user_id=user.user.id,
        unread_only=unread_only,
        cursor=cursor,
        limit=limit,
        scope=scope,
    )
    await session.commit()
    return result


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(
    scope: NotificationScopeLiteral = Query(default="all", description=_SCOPE_DOC),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UnreadCount:
    return await _svc(session).unread_count(user_id=user.user.id, scope=scope)


@router.post("/{notif_id}/read", response_model=NotificationView)
async def mark_read(
    notif_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> NotificationView:
    return await _svc(session).mark_read(user_id=user.user.id, notif_id=notif_id)


@router.post("/read-all", response_model=MarkReadResponse)
async def mark_all_read(
    scope: NotificationScopeLiteral = Query(default="all", description=_SCOPE_DOC),
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MarkReadResponse:
    return await _svc(session).mark_all_read(user_id=user.user.id, scope=scope)


@router.delete(
    "/{notif_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_notification(
    notif_id: int,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).delete(user_id=user.user.id, notif_id=notif_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
