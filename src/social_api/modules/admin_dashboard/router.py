"""Admin dashboard HTTP endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_db
from social_api.deps import CurrentUser, require_roles
from social_api.modules.admin_dashboard.schemas import DashboardOverview
from social_api.modules.admin_dashboard.service import DashboardService
from social_api.modules.auth.models import UserRole

router = APIRouter(prefix="/admin/dashboard", tags=["admin"])


# NOTE: empty-string route "" — NOT "/".
# With prefix="/admin/dashboard", "" resolves to GET /api/v1/admin/dashboard
# (direct match). A "/" would resolve to .../dashboard/ and trip
# redirect_slashes, turning the call into a 307 that httpx clients don't
# follow — the same trap documented in modules/audit/router.py.
@router.get("", response_model=DashboardOverview)
async def dashboard_overview(
    window_days: int = Query(default=30, ge=1, le=365),
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> DashboardOverview:
    """Admin-only: one-shot overview of users, content, storage and traffic.

    `_admin` is deliberately unused in the body — it is the RBAC gate. The
    dependency raises 403 before the handler runs for non-admins.
    """
    return await DashboardService(session).overview(window_days=window_days)
