"""media.message_id — bind media to chat messages (M16).

Revision ID: 0009_media_message_id
Revises: 0008_chat
Create Date: 2026-10-26 00:00:00.000000

Why: M16 lets a chat message carry a media attachment (single media per
message). Chat models.Message already FKs media.id via media_id; the
reverse pointer — media.message_id — lets us prevent media-reuse and
unbind orphaned media when a message is deleted.

The unique index on (message_id) enforces one-media-per-message. MySQL
treats multiple NULLs as distinct, so unattached media remain unaffected.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_media_message_id"
down_revision: str | None = "0008_chat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add the column (nullable; existing media rows remain valid).
    op.add_column(
        "media",
        sa.Column("message_id", sa.BigInteger(), nullable=True),
    )
    # 2. FK → messages.id, ON DELETE SET NULL (deleting a message
    #    unbinds its media → orphan, GC'd by retention).
    op.create_foreign_key(
        "fk_media_message_id_messages",
        "media",
        "messages",
        ["message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # 3. Unique index — one media per message.
    #    MySQL uses this as the supporting index for the FK above.
    op.create_index(
        "uq_media_message_id",
        "media",
        ["message_id"],
        unique=True,
    )


def downgrade() -> None:
    # MySQL requires an index to back a foreign key. Since
    # uq_media_message_id is that supporting index, we MUST drop the FK
    # before dropping the index — otherwise MySQL 1553s:
    #   "Cannot drop index 'uq_media_message_id':
    #    needed in a foreign key constraint"
    #
    # Order: FK → unique index → column.
    op.drop_constraint(
        "fk_media_message_id_messages",
        "media",
        type_="foreignkey",
    )
    op.drop_index("uq_media_message_id", table_name="media")
    op.drop_column("media", "message_id")
