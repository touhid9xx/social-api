"""Admin feature-flag endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.flags.provider import (
    BUILTIN_FLAGS,
    EnvFeatureFlags,
    set_user_override,
)
from social_api.db.session import get_db
from social_api.deps import CurrentUser, require_roles
from social_api.modules.audit.service import AuditService
from social_api.modules.auth.models import UserRole

router = APIRouter(prefix="/flags", tags=["flags"])

KNOWN_FLAGS = list(BUILTIN_FLAGS.keys())


class FlagView(BaseModel):
    name: str
    env_value: bool
    builtin_value: bool
    # overridden_user_count intentionally OMITTED from the list response:
    # count_user_overrides runs a SCAN over the whole Redis keyspace per
    # flag, and calling it 4x per GET /flags collapses an admin dashboard
    # poll into thousands of SCAN iterations. Admins needing per-flag
    # counts can query one flag on demand (see GET /flags/{name}, add
    # in M21) — or we materialize counts in a background job later.


class FlagList(BaseModel):
    flags: list[FlagView]


class FlagOverride(BaseModel):
    user_id: int
    enabled: bool | None  # None = clear


class FlagOverrideResponse(BaseModel):
    flag: str
    user_id: int
    # Echo the applied value so the caller can assert on the response
    # without a follow-up GET. None = override cleared (falls back to env).
    enabled: bool | None
    action: Literal["set", "cleared"]


@router.get("", response_model=FlagList)
async def list_flags(
    _admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
) -> FlagList:
    env = EnvFeatureFlags()
    out: list[FlagView] = []
    for name in KNOWN_FLAGS:
        out.append(
            FlagView(
                name=name,
                env_value=env.is_enabled_sync(name),
                builtin_value=BUILTIN_FLAGS.get(name, False),
            )
        )
    return FlagList(flags=out)


@router.post("/{flag_name}/override", response_model=FlagOverrideResponse)
async def override_flag(
    flag_name: str,
    payload: FlagOverride,
    admin: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
    session: AsyncSession = Depends(get_db),
) -> FlagOverrideResponse:
    if flag_name not in KNOWN_FLAGS:
        from social_api.exceptions import BadRequestError

        raise BadRequestError(
            f"Unknown flag: {flag_name}",
            detail={"known_flags": KNOWN_FLAGS},
        )

    await set_user_override(
        user_id=payload.user_id,
        name=flag_name,
        enabled=payload.enabled,
    )

    action: Literal["set", "cleared"] = "cleared" if payload.enabled is None else "set"

    # Audit entity="user" — the *effect* of a flag override is per-user,
    # so entity_id=user_id makes the row findable via
    # /audit?entity=user&entity_id=N. entity="flag" with entity_id=None
    # would force forensic queries to scan the JSON `after` field.
    await AuditService(session).write(
        actor_id=admin.user.id,
        action="FEATURE_FLAG_OVERRIDE",
        entity="user",
        entity_id=payload.user_id,
        after={
            "flag": flag_name,
            "enabled": payload.enabled,
            "action": action,
        },
    )

    # Persist the audit row. Without this, get_db's finally rolls back
    # uncommitted session state — the audit trail silently disappears.
    await session.commit()

    return FlagOverrideResponse(
        flag=flag_name,
        user_id=payload.user_id,
        enabled=payload.enabled,
        action=action,
    )
