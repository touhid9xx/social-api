"""Search repository — substring matching over `posts.body` and `profiles`."""

from __future__ import annotations

from datetime import datetime
from typing import Final, NamedTuple

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.modules.auth.models import User
from social_api.modules.follows.models import Block, Follow
from social_api.modules.posts.models import Post
from social_api.modules.users.models import Profile, Visibility

#: Backslash, declared once so the LIKE escape character used to build the
#: pattern and the one handed to `.ilike(escape=...)` can never drift apart.
_LIKE_ESCAPE: Final[str] = "\\"


class SearchUserRow(NamedTuple):
    user_id: int
    display_name: str | None
    avatar_url: str | None


def escape_like(term: str) -> str:
    """Neutralise LIKE metacharacters in a user-supplied search term.

    Without this, typing `%` matches every row and `_` matches any single
    character — the user searches for one thing and gets the whole table.
    The backslash itself must be escaped first, otherwise `\\%` would be
    read as an escaped backslash followed by a wildcard.
    """
    return (
        term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", f"{_LIKE_ESCAPE}%")
        .replace("_", f"{_LIKE_ESCAPE}_")
    )


class SearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def search_posts(
        self,
        *,
        viewer_id: int,
        term: str,
        cursor_ts: datetime | None,
        cursor_id: int | None,
        limit: int,
    ) -> list[Post]:
        """Newest-first page of visible posts whose body contains `term`.

        Visibility is enforced in SQL rather than by re-checking each row the
        way `PostsService.list_by_author` does (two extra queries per post).
        The predicates mirror `PostsService._assert_visible` exactly:
          - your own posts are always visible;
          - PUBLIC posts are visible to anyone not blocked either way;
          - FOLLOWERS posts additionally require a follow edge;
          - PRIVATE posts of others never appear;
          - any block in either direction hides the author entirely.
        """
        pattern = f"%{escape_like(term)}%"

        blocked = exists().where(
            or_(
                and_(Block.blocker_id == viewer_id, Block.blocked_id == Post.author_id),
                and_(Block.blocker_id == Post.author_id, Block.blocked_id == viewer_id),
            )
        )
        follows_author = exists().where(
            and_(Follow.follower_id == viewer_id, Follow.followee_id == Post.author_id)
        )

        stmt = select(Post).where(
            Post.deleted_at.is_(None),
            Post.body.ilike(pattern, escape=_LIKE_ESCAPE),
            ~blocked,
            or_(
                Post.author_id == viewer_id,
                Post.visibility == Visibility.PUBLIC,
                and_(Post.visibility == Visibility.FOLLOWERS, follows_author),
            ),
        )
        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    Post.created_at < cursor_ts,
                    and_(
                        Post.created_at == cursor_ts,
                        Post.id < cursor_id,
                    ),
                )
            )
        # Over-fetch by one so the service can tell "exactly `limit` rows
        # remain" from "there is another page", same contract as the other
        # keyset repositories.
        stmt = stmt.order_by(Post.created_at.desc(), Post.id.desc()).limit(limit + 1)
        res = await self._s.execute(stmt)
        return list(res.scalars().all())

    async def search_users(self, *, term: str, limit: int) -> list[SearchUserRow]:
        """People whose display name contains `term`, A→Z.

        Inner join on `profiles`: a user with no profile row has no name to
        match or show, so they cannot appear here. Deactivated and soft-deleted
        accounts are excluded — searching must not surface them.
        """
        pattern = f"%{escape_like(term)}%"
        stmt = (
            select(User.id, Profile.display_name, Profile.avatar_url)
            .join(Profile, Profile.user_id == User.id)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                Profile.deleted_at.is_(None),
                Profile.display_name.ilike(pattern, escape=_LIKE_ESCAPE),
            )
            .order_by(Profile.display_name.asc(), User.id.asc())
            .limit(limit)
        )
        res = await self._s.execute(stmt)
        return [SearchUserRow(*row) for row in res.all()]
