"""Presence service — reads Redis counter."""

from __future__ import annotations

from social_api.cache.redis import get_redis
from social_api.modules.presence.schemas import PresenceView
from social_api.realtime.channels import presence_check


class PresenceService:
    async def get(self, *, user_id: int) -> PresenceView:
        redis = get_redis()
        count = await presence_check(redis=redis, user_id=user_id)
        return PresenceView(user_id=user_id, online=count > 0, connections=count)
