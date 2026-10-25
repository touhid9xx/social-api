"""Feed schemas."""

from __future__ import annotations

from pydantic import BaseModel

from social_api.modules.posts.schemas import PostView


class HomeFeedPage(BaseModel):
    items: list[PostView]
    next_cursor: str | None = None
    cache_hit: bool = False
