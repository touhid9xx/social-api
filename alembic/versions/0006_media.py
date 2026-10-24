"""media table.

Revision ID: 0006_media
Revises: 0005_posts_comments_likes
Create Date: 2026-01-06 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_media"
down_revision: str | None = "0005_posts_comments_likes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.BigInteger(), nullable=False),
        sa.Column("post_id", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mime", sa.String(length=64), nullable=False),
        # Lowercase values match MediaKind.IMAGE.value == "image" (StrEnum).
        sa.Column(
            "kind",
            sa.Enum("image", "video", name="media_kind"),
            nullable=False,
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_media_owner_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["posts.id"],
            name=op.f("fk_media_post_id_posts"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_media")),
        sa.CheckConstraint(
            "size_bytes > 0", name=op.f("ck_media_size_positive")
        ),
    )
    op.create_index(
        op.f("ix_media_owner_created"),
        "media",
        ["owner_id", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_media_post_id"), "media", ["post_id"], unique=False
    )
    op.create_index(
        op.f("uq_media_owner_sha"),
        "media",
        ["owner_id", "sha256"],
        unique=True,
    )
    op.create_index(
        op.f("ix_media_deleted_at"), "media", ["deleted_at"], unique=False
    )


def downgrade() -> None:
    # MySQL: DROP TABLE removes all indexes + FK constraints + PK + unique
    # constraints atomically. Never drop_index before drop_table (1553/1091).
    op.drop_table("media")
    sa.Enum(name="media_kind").drop(op.get_bind(), checkfirst=True)
