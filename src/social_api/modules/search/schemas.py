"""Search schemas — PII-free result rows for the people and post sections."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from social_api.modules.posts.schemas import PostView


class SearchUserHit(BaseModel):
    """One person in the search results.

    Mirrors `FollowUserView`: id, name, avatar and nothing else. No email,
    no phone, no verification flags — search is not an admin surface.
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: int
    display_name: str | None = None
    avatar_url: str | None = None


class SearchResults(BaseModel):
    """Response for `GET /search`.

    `users` is a capped relevance-ordered shortlist rendered as "people"
    cards, so it deliberately carries no cursor. `posts` is keyset-paginated
    exactly like every other list endpoint, so `next_cursor` applies to posts.
    """

    query: str
    users: list[SearchUserHit]
    posts: list[PostView]
    next_cursor: str | None = None
