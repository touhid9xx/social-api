"""reports table.

Revision ID: 0010_moderation
Revises: 0009_media_message_id
Create Date: 2026-01-10 00:00:00.000000

Why: M17 moderation — users report content/users, moderators triage and
resolve. Deduped once per (reporter, target, day) via a unique index
backed by a day_bucket column so a user can't spam-report the same
target all day.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_moderation"
down_revision: str | None = "0009_media_message_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- Enums (explicit create; retry-safe under partial failures) ----
    report_target_type = sa.Enum(
        "POST", "COMMENT", "USER", "MESSAGE",
        name="report_target_type",
    )
    report_reason = sa.Enum(
        "SPAM", "ABUSE", "HARASSMENT", "OTHER",
        name="report_reason",
    )
    report_status = sa.Enum(
        "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED",
        name="report_status",
    )
    bind = op.get_bind()
    report_target_type.create(bind, checkfirst=True)
    report_reason.create(bind, checkfirst=True)
    report_status.create(bind, checkfirst=True)

    op.create_table(
        "reports",
        sa.Column(
            "id", sa.BigInteger(), autoincrement=True, nullable=False
        ),
        sa.Column("reporter_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "target_type",
            sa.Enum(
                "POST", "COMMENT", "USER", "MESSAGE",
                name="report_target_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(
                "SPAM", "ABUSE", "HARASSMENT", "OTHER",
                name="report_reason",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED",
                name="report_status",
                create_type=False,
            ),
            nullable=False,
            server_default="OPEN",
        ),
        sa.Column("reviewer_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "resolution_note", sa.String(length=500), nullable=True
        ),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("day_bucket", sa.Date(), nullable=False),
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
            ["reporter_id"],
            ["users.id"],
            name=op.f("fk_reports_reporter_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_id"],
            ["users.id"],
            name=op.f("fk_reports_reviewer_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
        sa.CheckConstraint(
            "length(details) <= 5000 OR details IS NULL",
            name=op.f("ck_reports_details_len"),
        ),
    )
    op.create_index(
        "uq_reports_dedupe",
        "reports",
        ["reporter_id", "target_type", "target_id", "day_bucket"],
        unique=True,
    )
    op.create_index(
        "ix_reports_status_created",
        "reports",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_reports_target",
        "reports",
        ["target_type", "target_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reports_reporter"),
        "reports",
        ["reporter_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_reports_deleted_at"),
        "reports",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # MySQL: DROP TABLE atomically removes all indexes + FK constraints +
    # PK + unique constraints. Never drop_index before drop_table
    # (error 1553 for FK-backed indexes, 1091 for already-dropped ones).
    # Same pattern as 0006_media, 0007_notifications, 0008_chat, and
    # 0009_media_message_id.
    op.drop_table("reports")
    sa.Enum(name="report_status").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(name="report_reason").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(name="report_target_type").drop(
        op.get_bind(), checkfirst=True
    )
