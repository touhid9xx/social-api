"""baseline — establishes the migration chain.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-01-01 00:00:00.000000

Intentionally empty. First real schema changes land in M4 (User model).
A baseline migration anchors the chain so future `downgrade -1` is safe.
"""

from __future__ import annotations

from typing import Sequence, Union

revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Baseline — no-op."""


def downgrade() -> None:
    """Baseline — no-op."""
