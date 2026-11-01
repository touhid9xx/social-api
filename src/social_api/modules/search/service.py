"""Search service — people shortlist plus keyset-paginated post hits."""

from __future__ import annotations

from datetime import datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.modules.likes.repository import LikesRepository
from social_api.modules.media.repository import MediaRepository
from social_api.modules.media.schemas import MediaView
from social_api.modules.media.service import get_storage_backend, media_by_post

# Reuse the posts module's view builder rather than duplicating the
# `is_edited`/`media`/`is_liked_by_me` derivation. A second implementation
# would drift the moment PostView gains a field.
from social_api.modules.posts.service import _to_view as _post_view
from social_api.modules.search.repository import SearchRepository, SearchUserRow
from social_api.modules.search.schemas import SearchResults, SearchUserHit

#: Shortest term worth querying for. A single character matches most of the
#: table and is never a real search.
MIN_TERM_LENGTH: Final[int] = 2

#: People cards are a shortlist, not an endless list, so cap them regardless
#: of the post `limit` — otherwise `?limit=100` would return 100 people above
#: the post results.
MAX_USER_HITS: Final[int] = 10


def _user_hit(row: SearchUserRow) -> SearchUserHit:
    return SearchUserHit(
        user_id=row.user_id,
        display_name=row.display_name,
        avatar_url=row.avatar_url,
    )


class SearchService:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session
        self._repo = SearchRepository(session)
        self._likes = LikesRepository(session)
        self._media_repo = MediaRepository(session)

    async def search(
        self,
        *,
        viewer_id: int,
        query: str,
        cursor: str | None,
        limit: int | None,
    ) -> SearchResults:
        term = query.strip()
        if len(term) < MIN_TERM_LENGTH:
            raise BadRequestError(
                f"Search term must be at least {MIN_TERM_LENGTH} characters",
                detail={"code": "QUERY_TOO_SHORT", "min_length": MIN_TERM_LENGTH},
            )

        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None

        users = await self._repo.search_users(term=term, limit=min(lmt, MAX_USER_HITS))
        posts = await self._repo.search_posts(
            viewer_id=viewer_id,
            term=term,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(posts) > lmt:
            last_raw = posts[lmt - 1]
            next_cursor = encode_cursor([last_raw.created_at, last_raw.id])
            posts = posts[:lmt]

        post_ids = [p.id for p in posts]
        liked_ids = await self._likes.exists_batch(
            user_id=viewer_id,
            target_type="post",
            target_ids=post_ids,
        )
        media: dict[int, list[MediaView]] = {}
        if post_ids:
            media = await media_by_post(
                self._media_repo,
                get_storage_backend(),
                post_ids=post_ids,
            )

        return SearchResults(
            query=term,
            users=[_user_hit(row) for row in users],
            posts=[
                _post_view(
                    post,
                    is_liked=post.id in liked_ids,
                    media=media.get(post.id),
                )
                for post in posts
            ],
            next_cursor=next_cursor,
        )
