"""profiles + user_consent tables.

Revision ID: 0003_profiles_consent
Revises: 0002_users
Create Date: 2026-01-03 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_profiles_consent"
down_revision: str | None = "0002_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Module-level Enum objects — SINGLE source of truth for upgrade + downgrade.
# Values MUST be lowercase to match Visibility/ConsentChannel StrEnum .value.
visibility_enum = sa.Enum("public", "followers", "private", name="profile_visibility")
consent_channel_enum = sa.Enum(
    "email_marketing",
    "sms_marketing",
    "analytics",
    "product_updates",
    name="consent_channel",
)


def upgrade() -> None:
    # ── profiles ─────────────────────────────────────────────────────────
    op.create_table(
        "profiles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("location", sa.String(length=128), nullable=True),
        sa.Column("website", sa.String(length=256), nullable=True),
        # PII columns: physical storage is VARCHAR(1024) / TEXT;
        # EncryptedString/EncryptedText wrap these at the ORM level.
        sa.Column("dob", sa.String(length=1024), nullable=True),
        sa.Column("phone", sa.String(length=1024), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column(
            "visibility",
            visibility_enum,
            nullable=False,
            server_default="public",
        ),
        sa.Column(
            "pii_visibility",
            visibility_enum,
            nullable=False,
            server_default="private",
        ),
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
            name=op.f("fk_profiles_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_profiles")),
        sa.UniqueConstraint("user_id", name=op.f("uq_profiles_user_id")),
    )
    op.create_index(op.f("ix_profiles_user_id"), "profiles", ["user_id"], unique=False)
    op.create_index(op.f("ix_profiles_visibility"), "profiles", ["visibility"], unique=False)
    op.create_index(op.f("ix_profiles_deleted_at"), "profiles", ["deleted_at"], unique=False)

    # ── user_consent ─────────────────────────────────────────────────────
    op.create_table(
        "user_consent",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("channel", consent_channel_enum, nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("granted_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=256), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_consent_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_consent")),
    )
    op.create_index(op.f("ix_user_consent_user"), "user_consent", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_user_consent_user_channel"),
        "user_consent",
        ["user_id", "channel"],
        unique=False,
    )


def downgrade() -> None:
    # ── user_consent ─────────────────────────────────────────────────────
    # Do NOT drop indexes separately on MySQL: (a) FK-backing index cannot be
    # dropped while the FK exists (error 1553), (b) DROP TABLE removes every
    # index and constraint the table owns. Just drop the table.
    op.drop_table("user_consent")
    # Enum drop: safe no-op on MySQL (inline), required on PostgreSQL.
    consent_channel_enum.drop(op.get_bind(), checkfirst=True)

    # ── profiles ─────────────────────────────────────────────────────────
    op.drop_table("profiles")
    visibility_enum.drop(op.get_bind(), checkfirst=True)
