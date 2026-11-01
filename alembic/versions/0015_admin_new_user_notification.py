"""add ADMIN_NEW_USER to the notification_type enum.

Revision ID: 0015_admin_new_user
Revises: 0014_analytics
Create Date: 2026-02-08 00:00:00.000000

`NotificationType` gained a six member (`admin_new_user`) so that a fresh
registration can alert every active admin. The column is a native MySQL ENUM
created in `0007_notifications`, so the member has to be appended to the type
itself — SQLAlchemy does not migrate enum members for you, and inserting a row
whose type is not in the enum fails with a truncation error rather than a
Python exception.

`MODIFY COLUMN` restates the *whole* enum, so the order below is copied from
`0007_notifications` verbatim with the new member appended. Appending (rather
than inserting) keeps the stored integer indexes of existing rows stable — a
MySQL ENUM is an index into this list, and reordering it would silently rewrite
every historical row's meaning.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_admin_new_user"
down_revision: str | None = "0014_analytics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Order matters: identical to 0007 with the new member appended.
_OLD = (
    "FOLLOW",
    "LIKE_POST",
    "LIKE_COMMENT",
    "COMMENT_POST",
    "COMMENT_REPLY",
)
_NEW = (*_OLD, "ADMIN_NEW_USER")


def _enum(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.execute(
        sa.text(f"ALTER TABLE notifications MODIFY COLUMN type ENUM({_enum(_NEW)}) NOT NULL")
    )


def downgrade() -> None:
    # The enum cannot go back to five members while rows still reference the
    # sixth, so those rows are removed first. They are alerts about a
    # registration that the older schema has no way to express; losing them is
    # the cost of rolling the feature back.
    op.execute(sa.text("DELETE FROM notifications WHERE type = 'ADMIN_NEW_USER'"))
    op.execute(
        sa.text(f"ALTER TABLE notifications MODIFY COLUMN type ENUM({_enum(_OLD)}) NOT NULL")
    )
