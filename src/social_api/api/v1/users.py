"""Expose users router at /api/v1/users/*."""

from __future__ import annotations

from social_api.modules.users.router import router as users_router

__all__ = ["router"]

router = users_router
