"""notifications table.

Revision ID: 0007_notifications
Revises: 0006_media
Create Date: 2026-01-07 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_notifications"
down_revision: str | None = "0006_media"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create enums explicitly (MySQL-safe). Alembic's inline sa.Enum() in
    # create_table sometimes errors with "Duplicate column name" on retry
    # paths in MySQL 8; explicit .create(checkfirst=True) is idempotent.
    notification_type = sa.Enum(
        "FOLLOW",
        "LIKE_POST",
        "LIKE_COMMENT",
        "COMMENT_POST",
        "COMMENT_REPLY",
        name="notification_type",
    )
    notification_target_type = sa.Enum(
        "USER",
        "POST",
        "COMMENT",
        name="notification_target_type",
    )
    bind = op.get_bind()
    notification_type.create(bind, checkfirst=True)
    notification_target_type.create(bind, checkfirst=True)

    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "FOLLOW",
                "LIKE_POST",
                "LIKE_COMMENT",
                "COMMENT_POST",
                "COMMENT_REPLY",
                name="notification_type",
                create_type=False,  # already created above
            ),
            nullable=False,
        ),
        sa.Column(
            "target_type",
            sa.Enum(
                "USER",
                "POST",
                "COMMENT",
                name="notification_target_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "is_read",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("day_bucket", sa.Date(), nullable=False),
        sa.Column("preview", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_notifications_actor_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(
        "uq_notifications_dedupe",
        "notifications",
        ["user_id", "actor_id", "type", "target_type", "target_id", "day_bucket"],
        unique=True,
    )
    op.create_index(
        "ix_notifications_inbox",
        "notifications",
        ["user_id", "is_read", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_notifications_deleted_at"),
        "notifications",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # MySQL: DROP TABLE removes indexes + FK constraints + PK atomically.
    # Never drop_index before drop_table (error 1553/1091). Order matters:
    #   1) drop_table
    #   2) drop enum types
    op.drop_table("notifications")
    sa.Enum(name="notification_target_type").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="notification_type").drop(op.get_bind(), checkfirst=True)
