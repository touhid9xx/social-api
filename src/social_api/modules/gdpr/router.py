"""GDPR HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.rate_limit import _key_by_user_or_ip, limiter
from social_api.db.session import get_db
from social_api.deps import (
    CurrentUser,
    get_current_user,
    get_current_user_allow_deleted,
)
from social_api.modules.gdpr.schemas import (
    CancelResponse,
    DeletionStatusView,
    ExportPayload,
)
from social_api.modules.gdpr.service import GdprService

router = APIRouter(prefix="/gdpr", tags=["gdpr"])


@router.get(
    "/export",
    response_class=JSONResponse,
    responses={
        200: {
            "description": (
                "Full user data export. Served as a JSON download "
                "(Content-Disposition: attachment)."
            ),
            "content": {"application/json": {}},
        },
    },
)
@limiter.limit("1/minute", key_func=_key_by_user_or_ip)
async def export_data(
    request: Request,
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """GDPR right-of-access: dump everything we have on the caller.

    Requires a normal (non-deleted) user — a soft-deleted account
    cannot export its data, per M19 design. If you want export to
    work during the grace window, switch this dependency to
    get_current_user_allow_deleted. For now: strict.

    Rate-limited to 1/min — joins several tables and returns a full
    snapshot; no reason to allow abuse.
    """
    _ = (request, response)  # required by @limiter.limit for header injection

    payload: ExportPayload = await GdprService(session).export(user_id=user.user.id)
    body = payload.model_dump(mode="json")
    filename = f"gdpr-export-{user.user.id}-{payload.exported_at.date()}.json"
    return JSONResponse(
        content=body,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/cancel-delete", response_model=CancelResponse)
async def cancel_deletion(
    user: CurrentUser = Depends(get_current_user_allow_deleted),
    session: AsyncSession = Depends(get_db),
) -> CancelResponse:
    """Undo a pending account deletion (within the 30-day window).

    Uses get_current_user_allow_deleted: the user *is* soft-deleted at
    this point (that's the whole reason they're cancelling), so the
    normal dependency would 401 before we ever reach the service.

    The service flushes but the caller (this handler) must commit so
    the reversed deleted_at + is_active persist.
    """
    svc = GdprService(session)
    out = await svc.cancel_deletion(user_id=user.user.id)
    await session.commit()
    return out


@router.get("/deletion-status", response_model=DeletionStatusView)
async def deletion_status(
    user: CurrentUser = Depends(get_current_user_allow_deleted),
    session: AsyncSession = Depends(get_db),
) -> DeletionStatusView:
    """Query the state of any pending deletion request.

    Uses get_current_user_allow_deleted: the user must be able to
    check what's scheduled even after /users/me deleted them. This
    is the read-side of the grace window.
    """
    return await GdprService(session).deletion_status(user_id=user.user.id)
