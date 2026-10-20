"""API v1 aggregate router. Grows with each milestone."""

from __future__ import annotations

from fastapi import APIRouter

api_router = APIRouter()

# Milestones will add: auth, users, posts, comments, likes, follows,
# feed, media, notifications, chat, presence, moderation, audit, gdpr,
# admin, ws.
