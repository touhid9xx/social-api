"""deletion_requests table.

Revision ID: 0012_gdpr
Revises: 0011_audit
Create Date: 2026-01-12 00:00:00.000000

Why: M19 GDPR — record of user-initiated account-deletion requests.
The Celery retention sweep reads `WHERE status='SCHEDULED' AND
scheduled_hard_delete_at < NOW()` and calls GdprService.hard_delete().
The cancellation path flips status to 'CANCELLED' and reverses the
soft-delete.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_gdpr"
down_revision: str | None = "0011_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Explicit enum creation (MySQL-safe, retry-safe under partial
    # failures). Same pattern as 0006/0007/0008/0009/0010.
    deletion_status = sa.Enum(
        "SCHEDULED",
        "COMPLETED",
        "CANCELLED",
        name="deletion_status",
    )
    bind = op.get_bind()
    deletion_status.create(bind, checkfirst=True)

    op.create_table(
        "deletion_requests",
        sa.Column(
            "id", sa.BigInteger(), autoincrement=True, nullable=False
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "scheduled_hard_delete_at",
            sa.DateTime(),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "SCHEDULED",
                "COMPLETED",
                "CANCELLED",
                name="deletion_status",
                create_type=False,  # already created above
            ),
            nullable=False,
            server_default="SCHEDULED",
        ),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
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
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_deletion_requests_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_deletion_requests")
        ),
    )
    op.create_index(
        "ix_deletion_user",
        "deletion_requests",
        ["user_id"],
        unique=False,
    )
    # Composite index for get_active_for_user(user_id) queries: filters
    # by user_id AND status. Serves both /gdpr/deletion-status (single
    # user, any status) and the retention sweep batch query (status
    # filtered, scheduled_hard_delete_at range).
    op.create_index(
        "ix_deletion_user_status",
        "deletion_requests",
        ["user_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_deletion_status_scheduled",
        "deletion_requests",
        ["status", "scheduled_hard_delete_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_deletion_deleted_at"),
        "deletion_requests",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # MySQL: DROP TABLE atomically removes all indexes + FK constraints
    # + PK. Never drop_index before drop_table (error 1553 for FK-backed
    # indexes, 1091 for already-auto-dropped ones). Same pattern as
    # 0006_media, 0007_notifications, 0008_chat, 0009_media_message_id,
    # 0010_moderation, 0011_audit.
    op.drop_table("deletion_requests")
    sa.Enum(name="deletion_status").drop(
        op.get_bind(), checkfirst=True
    )
