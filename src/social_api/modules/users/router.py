"""Users HTTP endpoints — /me routes declared BEFORE /{user_id}."""

from __future__ import annotations

import contextlib

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.db.session import get_db
from social_api.deps import CurrentUser, get_current_user, require_roles
from social_api.modules.auth.models import UserRole
from social_api.modules.gdpr.exceptions import AlreadyScheduledForDeletionError
from social_api.modules.gdpr.service import GdprService
from social_api.modules.users.schemas import (
    AdminUserPage,
    AdminUserUpdate,
    AdminUserView,
    ConsentGrantRequest,
    ConsentList,
    DeleteMeResponse,
    ProfilePublic,
    ProfileSelf,
    ProfileUpdate,
)
from social_api.modules.users.service import UsersService

router = APIRouter(prefix="/users", tags=["users"])


def _svc(session: AsyncSession) -> UsersService:
    return UsersService(session)


@router.get("/me", response_model=ProfileSelf)
async def get_me(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfileSelf:
    result = await _svc(session).get_self_profile(user_id=user.user.id)
    await session.commit()  # get_self_profile may create default profile
    return result


@router.patch("/me", response_model=ProfileSelf)
async def update_me(
    payload: ProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfileSelf:
    result = await _svc(session).update_profile(user_id=user.user.id, payload=payload)
    await session.commit()
    return result


@router.post("/me/consent", status_code=201)
async def grant_consent(
    payload: ConsentGrantRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    await _svc(session).grant_consent(
        user_id=user.user.id,
        channel=payload.channel,
        ip=client_ip,
        user_agent=user_agent,
    )
    await session.commit()
    return {"message": "Consent recorded"}


@router.delete(
    "/me/consent/{channel}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def revoke_consent(
    channel: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await _svc(session).revoke_consent(user_id=user.user.id, channel=channel)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/consent", response_model=ConsentList)
async def list_consents(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ConsentList:
    rows = await _svc(session).list_consents(user_id=user.user.id)
    return ConsentList(consents=rows)


@router.delete("/me", response_model=DeleteMeResponse)
async def delete_me(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> DeleteMeResponse:
    users = _svc(session)
    result = await users.soft_delete_me(user_id=user.user.id)

    gdpr = GdprService(session)
    with contextlib.suppress(AlreadyScheduledForDeletionError):
        await gdpr.schedule_deletion(user=user.user)

    await session.commit()
    return result


# NOTE: empty-string route "" — NOT "/".
# With prefix="/users", "" resolves to GET /api/v1/users (direct match).
# A "/" here would resolve to /api/v1/users/ and cause FastAPI's default
# redirect_slashes to answer with a 307. httpx clients don't follow
# redirects by default, so the 307 would surface as the final response.
# Same trap the audit router hit.
@router.get("", response_model=AdminUserPage)
async def list_users(
    cursor: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> AdminUserPage:
    """Admin-only: cursor-paginated directory of non-deleted accounts.

    `_admin` is deliberately unused in the body — it is the RBAC gate, and
    the dependency raises 403 before the handler runs. Declared above
    `/{user_id}` so the literal path wins over the parameterised one.

    Read-only, so no `session.commit()` — unlike the `/me` routes this
    handler never creates or mutates a row.
    """
    return await _svc(session).list_users(cursor=cursor, limit=limit)


@router.get("/{user_id}", response_model=ProfilePublic)
async def get_profile(
    user_id: int,
    viewer: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ProfilePublic:
    return await _svc(session).get_public_profile(target_user_id=user_id, viewer_id=viewer.user.id)


# ---- Admin: account management ----
#
# Three mutations over the same `/users/{user_id}` resource, all behind the
# same `require_roles(ADMIN)` gate as the directory above. They answer with
# the full `AdminUserView`, not a bare `{message}`, so the client can patch
# the row it is already showing instead of refetching the page.
#
# `admin.user.id` is passed through to the service, which owns both guards
# (can't act on yourself, can't remove the last admin). Those rules need
# live DB state, so they cannot live in a dependency.


@router.patch("/{user_id}", response_model=AdminUserView)
async def admin_update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> AdminUserView:
    """Admin-only: change one account's role / active / verified flag."""
    result = await _svc(session).admin_update_user(
        actor_id=admin.user.id, user_id=user_id, payload=payload
    )
    await session.commit()
    return result


@router.post("/{user_id}/activate", response_model=AdminUserView)
async def admin_activate_user(
    user_id: int,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> AdminUserView:
    """Admin-only: re-enable a deactivated account and mark it verified.

    A POST, not a PATCH, because it is an action rather than a field write:
    it always lands in the same state, so it is safe to retry.
    """
    result = await _svc(session).admin_activate_user(actor_id=admin.user.id, user_id=user_id)
    await session.commit()
    return result


@router.delete("/{user_id}", response_model=AdminUserView)
async def admin_delete_user(
    user_id: int,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> AdminUserView:
    """Admin-only: soft-delete an account (30-day GDPR window still applies)."""
    result = await _svc(session).admin_delete_user(actor_id=admin.user.id, user_id=user_id)
    await session.commit()
    return result
