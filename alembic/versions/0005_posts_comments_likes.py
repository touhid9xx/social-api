"""posts + comments + likes tables.

Revision ID: 0005_posts_comments_likes
Revises: 0004_follows_blocks_mutes
Create Date: 2026-01-05 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_posts_comments_likes"
down_revision: Union[str, None] = "0004_follows_blocks_mutes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "posts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "visibility",
            sa.Enum(
                "PUBLIC",
                "FOLLOWERS",
                "PRIVATE",
                name="profile_visibility",
                create_type=False,
            ),
            nullable=False,
            server_default="PUBLIC",
        ),
        sa.Column("media_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "comment_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"], name=op.f("fk_posts_author_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_posts")),
        sa.CheckConstraint("length(body) <= 5000", name=op.f("ck_posts_body_len")),
        sa.CheckConstraint(
            "like_count >= 0", name=op.f("ck_posts_like_count_nonneg")
        ),
        sa.CheckConstraint(
            "comment_count >= 0", name=op.f("ck_posts_comment_count_nonneg")
        ),
    )
    op.create_index(
        op.f("ix_posts_author_created"),
        "posts",
        ["author_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_posts_visibility_created"),
        "posts",
        ["visibility", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_posts_deleted_at"), "posts", ["deleted_at"], unique=False
    )

    op.create_table(
        "comments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("post_id", sa.BigInteger(), nullable=False),
        sa.Column("author_id", sa.BigInteger(), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["post_id"], ["posts.id"], name=op.f("fk_comments_post_id_posts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"], ["users.id"], name=op.f("fk_comments_author_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["comments.id"],
            name=op.f("fk_comments_parent_id_comments"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comments")),
        sa.CheckConstraint(
            "length(body) <= 2000", name=op.f("ck_comments_body_len")
        ),
        sa.CheckConstraint(
            "depth >= 1 AND depth <= 2", name=op.f("ck_comments_depth_range")
        ),
        sa.CheckConstraint(
            "like_count >= 0", name=op.f("ck_comments_like_count_nonneg")
        ),
    )
    op.create_index(
        op.f("ix_comments_post_created"),
        "comments",
        ["post_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_comments_parent_created"),
        "comments",
        ["parent_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_comments_author"), "comments", ["author_id"], unique=False
    )
    op.create_index(
        op.f("ix_comments_deleted_at"), "comments", ["deleted_at"], unique=False
    )

    op.create_table(
        "likes",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "target_type",
            sa.Enum("POST", "COMMENT", name="like_target"),
            nullable=False,
        ),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_likes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "user_id", "target_type", "target_id", name=op.f("pk_likes")
        ),
    )
    op.create_index(
        op.f("ix_likes_target"),
        "likes",
        ["target_type", "target_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("likes")
    op.drop_table("comments")
    op.drop_table("posts")
