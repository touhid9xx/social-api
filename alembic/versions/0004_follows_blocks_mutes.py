"""follows + blocks + mutes tables.

Revision ID: 0004_follows_blocks_mutes
Revises: 0003_profiles_consent
Create Date: 2026-01-04 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_follows_blocks_mutes"
down_revision: str | None = "0003_profiles_consent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_edge_table(
    name: str,
    a_col: str,
    b_col: str,
    *,
    extra_idx_col: str,
    check_name: str,
) -> None:
    op.create_table(
        name,
        sa.Column(a_col, sa.BigInteger(), nullable=False),
        sa.Column(b_col, sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            [a_col], ["users.id"], name=op.f(f"fk_{name}_{a_col}_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            [b_col], ["users.id"], name=op.f(f"fk_{name}_{b_col}_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(a_col, b_col, name=op.f(f"pk_{name}")),
        sa.CheckConstraint(f"{a_col} <> {b_col}", name=op.f(check_name)),
    )
    op.create_index(
        op.f(f"ix_{name}_{extra_idx_col}"), name, [extra_idx_col], unique=False
    )


def upgrade() -> None:
    _create_edge_table(
        "follows",
        "follower_id",
        "followee_id",
        extra_idx_col="followee_id",
        check_name="ck_follows_not_self",
    )
    # Extra index for the other direction
    op.create_index(
        op.f("ix_follows_follower_id"), "follows", ["follower_id"], unique=False
    )
    op.create_index(
        op.f("ix_follows_followee_created"),
        "follows",
        ["followee_id", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_follows_follower_created"),
        "follows",
        ["follower_id", "created_at"],
        unique=False,
    )

    _create_edge_table(
        "blocks",
        "blocker_id",
        "blocked_id",
        extra_idx_col="blocked_id",
        check_name="ck_blocks_not_self",
    )

    _create_edge_table(
        "mutes",
        "muter_id",
        "muted_id",
        extra_idx_col="muted_id",
        check_name="ck_mutes_not_self",
    )


def downgrade() -> None:
    # MySQL: DROP TABLE removes all indexes, FK constraints, PK, unique
    # constraints atomically. drop_index calls are redundant — and fail
    # with error 1091/1146 if called after drop_table (or with 1553 if
    # called before, when the index backs a FK). Same rule as 0003.
    op.drop_table("mutes")
    op.drop_table("blocks")
    op.drop_table("follows")
