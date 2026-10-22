"""API v1 aggregate router."""

from __future__ import annotations

from fastapi import APIRouter

from social_api.api.v1 import auth, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
