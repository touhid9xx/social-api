"""analytics_visit table (aggregate, non-identifying request telemetry).

Revision ID: 0014_analytics
Revises: 0013_idempotency
Create Date: 2026-02-01 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_analytics"
down_revision: Union[str, None] = "0013_idempotency"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analytics_visit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("path_class", sa.String(length=16), nullable=False),
        sa.Column("is_authenticated", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("status_code", sa.SmallInteger(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=True),
        sa.Column("city", sa.String(length=64), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("weight", sa.SmallInteger(), nullable=False, server_default=sa.text("1")),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_analytics_visit")),
    )
    op.create_index(
        "ix_analytics_visit_day_class",
        "analytics_visit",
        ["day", "path_class"],
        unique=False,
    )
    op.create_index(
        "ix_analytics_visit_day_country",
        "analytics_visit",
        ["day", "country"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_analytics_visit_day_country", table_name="analytics_visit")
    op.drop_index("ix_analytics_visit_day_class", table_name="analytics_visit")
    op.drop_table("analytics_visit")
