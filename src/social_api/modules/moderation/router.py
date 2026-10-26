"""Moderation HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user, require_roles
from social_api.modules.auth.models import UserRole
from social_api.modules.moderation.models import ReportStatus
from social_api.modules.moderation.schemas import (
    ReportCreate,
    ReportPage,
    ReportUpdate,
    ReportView,
)
from social_api.modules.moderation.service import ModerationService

router = APIRouter(prefix="/moderation", tags=["moderation"])


def _svc(session: AsyncSession) -> ModerationService:
    return ModerationService(session)


@router.post(
    "/reports",
    response_model=ReportView,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute", key_func=_key_by_user_or_ip)
async def create_report(
    request: Request,
    response: Response,
    payload: ReportCreate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ReportView:
    # request/response required by slowapi's @limiter.limit (header injection)
    _ = (request, response)
    return await _svc(session).create_report(reporter_id=user.user.id, payload=payload)


@router.get("/reports", response_model=ReportPage)
async def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _moderator: CurrentUser = Depends(require_roles(UserRole.MODERATOR, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> ReportPage:
    # `status` is typed as the ReportStatus enum — FastAPI rejects any
    # value not in {OPEN, UNDER_REVIEW, RESOLVED, DISMISSED} with 422
    # before it reaches the service. Prevents both typos and any
    # injection attempt via the enum coercion path.
    return await _svc(session).list_reports(
        status_filter=status_filter,
        cursor=cursor,
        limit=limit,
    )


@router.patch("/reports/{report_id}", response_model=ReportView)
async def update_report(
    report_id: int,
    payload: ReportUpdate,
    moderator: CurrentUser = Depends(require_roles(UserRole.MODERATOR, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> ReportView:
    return await _svc(session).update_report(
        reviewer=moderator.user, report_id=report_id, payload=payload
    )
