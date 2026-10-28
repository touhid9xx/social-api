"""API v1 aggregate router."""

from __future__ import annotations

from fastapi import APIRouter

from social_api.api.v1 import (
    audit,
    auth,
    chat,
    comments,
    feed,
    flags,
    follows,
    gdpr,
    likes,
    media,
    moderation,
    notifications,
    posts,
    presence,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(chat.router)
api_router.include_router(users.router)
api_router.include_router(follows.router)
api_router.include_router(posts.router)
api_router.include_router(comments.router)
api_router.include_router(likes.router)
api_router.include_router(media.router)
api_router.include_router(feed.router)
api_router.include_router(notifications.router)
api_router.include_router(presence.router)
api_router.include_router(moderation.router)
api_router.include_router(audit.router)
api_router.include_router(gdpr.router)
api_router.include_router(flags.router)
