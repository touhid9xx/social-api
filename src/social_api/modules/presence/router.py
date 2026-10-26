"""Presence HTTP endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from social_api.deps import CurrentUser, get_current_user
from social_api.modules.presence.schemas import PresenceView
from social_api.modules.presence.service import PresenceService

router = APIRouter(prefix="/presence", tags=["presence"])


@router.get("/{user_id}", response_model=PresenceView)
async def get_presence(
    user_id: int,
    _viewer: CurrentUser = Depends(get_current_user),
) -> PresenceView:
    return await PresenceService().get(user_id=user_id)
