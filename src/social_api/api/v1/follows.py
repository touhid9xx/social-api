"""Expose follows router."""

from __future__ import annotations

from social_api.modules.follows.router import router as follows_router

__all__ = ["router"]

router = follows_router
