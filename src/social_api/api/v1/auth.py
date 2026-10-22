"""Expose auth router at /api/v1/auth/*."""

from __future__ import annotations

from social_api.modules.auth.router import router as auth_router

__all__ = ["router"]

router = auth_router
