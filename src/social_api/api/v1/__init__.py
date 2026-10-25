"""API v1 aggregate router."""

from __future__ import annotations

from fastapi import APIRouter

from social_api.api.v1 import (
    auth,
    comments,
    feed,
    follows,
    likes,
    media,
    posts,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(follows.router)
api_router.include_router(posts.router)
api_router.include_router(comments.router)
api_router.include_router(likes.router)
api_router.include_router(media.router)
api_router.include_router(feed.router)
