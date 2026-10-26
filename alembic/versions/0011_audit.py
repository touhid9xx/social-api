"""audit_log table.

Revision ID: 0011_audit
Revises: 0010_moderation
Create Date: 2026-01-11 00:00:00.000000

Why: M18 audit trail. Every sensitive action (auth, moderation,
destructive content ops, staff actions) writes a row here. Append-only;
soft-deleted rows can be purged after the retention window (M19).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_audit"
down_revision: str | None = "0010_moderation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column(
            "id", sa.BigInteger(), autoincrement=True, nullable=False
        ),
        sa.Column("actor_id", sa.BigInteger(), nullable=True),
        # `action` / `entity` are free-form strings (not enums) so new
        # sensitive actions can be added without a schema change. The
        # canonical set lives in the AuditService and is validated there.
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=True),
        # JSON diff columns. `before`/`after` are reserved words only in
        # trigger syntax; safe as column names — MySQL accepts them
        # unquoted, and SQLAlchemy will quote on demand for portability.
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        # Network context — filled from request middleware (client_ip +
        # user_agent + request_id are bound to structlog contextvars).
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=256), nullable=True),
        sa.Column("request_id", sa.String(length=36), nullable=True),
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
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_audit_log_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(
        "ix_audit_actor_created",
        "audit_log",
        ["actor_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_entity_created",
        "audit_log",
        ["entity", "entity_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_action_created",
        "audit_log",
        ["action", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_audit_deleted_at"),
        "audit_log",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # MySQL: DROP TABLE atomically removes all indexes + FKs + PK.
    # Never drop_index before drop_table (error 1553 for FK-backed
    # indexes, 1091 for already-auto-dropped ones). Same pattern as
    # 0006_media, 0007_notifications, 0008_chat, 0009_media_message_id,
    # 0010_moderation.
    op.drop_table("audit_log")
