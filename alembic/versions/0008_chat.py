"""chat_rooms + chat_room_members + messages.

Revision ID: 0008_chat
Revises: 0007_notifications
Create Date: 2026-01-08 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_chat"
down_revision: str | None = "0007_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- Enums: create explicitly (MySQL-safe, retry-safe) ----
    # Alembic's inline sa.Enum() in create_table can leave the enum
    # type partially-created on a mid-failure retry. Explicit .create()
    # with checkfirst=True is idempotent.
    chat_room_type_enum = sa.Enum("DIRECT", "GROUP", name="chat_room_type")
    chat_member_role_enum = sa.Enum(
        "MEMBER", "ADMIN", name="chat_member_role"
    )
    bind = op.get_bind()
    chat_room_type_enum.create(bind, checkfirst=True)
    chat_member_role_enum.create(bind, checkfirst=True)

    # ---- chat_rooms ----
    op.create_table(
        "chat_rooms",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "DIRECT",
                "GROUP",
                name="chat_room_type",
                create_type=False,  # already created above
            ),
            nullable=False,
        ),
        sa.Column("canonical_user_a", sa.BigInteger(), nullable=True),
        sa.Column("canonical_user_b", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=120), nullable=True),
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
            "version", sa.Integer(), nullable=False, server_default="1"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_rooms")),
        sa.UniqueConstraint(
            "canonical_user_a",
            "canonical_user_b",
            name="uq_chat_rooms_direct_pair",
        ),
        sa.CheckConstraint(
            "(type = 'DIRECT' AND canonical_user_a IS NOT NULL AND "
            " canonical_user_b IS NOT NULL AND canonical_user_a < canonical_user_b)"
            " OR "
            "(type = 'GROUP' AND canonical_user_a IS NULL AND "
            " canonical_user_b IS NULL)",
            name="ck_chat_rooms_canonical",
        ),
    )
    op.create_index(
        op.f("ix_chat_rooms_type"),
        "chat_rooms",
        ["type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_chat_rooms_deleted_at"),
        "chat_rooms",
        ["deleted_at"],
        unique=False,
    )

    # ---- chat_room_members ----
    op.create_table(
        "chat_room_members",
        sa.Column("room_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "MEMBER",
                "ADMIN",
                name="chat_member_role",
                create_type=False,
            ),
            nullable=False,
            server_default="MEMBER",
        ),
        sa.Column("last_read_message_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "joined_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["chat_rooms.id"],
            name=op.f("fk_chat_room_members_room_id_chat_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_chat_room_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "room_id", "user_id", name=op.f("pk_chat_room_members")
        ),
    )
    op.create_index(
        op.f("ix_chat_members_user"),
        "chat_room_members",
        ["user_id"],
        unique=False,
    )

    # ---- messages ----
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("room_id", sa.BigInteger(), nullable=False),
        sa.Column("sender_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("media_id", sa.BigInteger(), nullable=True),
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
            "version", sa.Integer(), nullable=False, server_default="1"
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["chat_rooms.id"],
            name=op.f("fk_messages_room_id_chat_rooms"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"],
            ["users.id"],
            name=op.f("fk_messages_sender_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media.id"],
            name=op.f("fk_messages_media_id_media"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
        sa.CheckConstraint(
            "length(body) <= 4000", name=op.f("ck_messages_body_len")
        ),
    )
    op.create_index(
        op.f("ix_messages_room_created"),
        "messages",
        ["room_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_sender"),
        "messages",
        ["sender_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_deleted_at"),
        "messages",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # MySQL: DROP TABLE removes all indexes + FK constraints + PK + unique
    # constraints atomically. Never drop_index before drop_table (errors
    # 1553/1091). Same pattern as 0006_media and 0007_notifications.
    #
    # Drop order matters for FK dependencies:
    #   1. messages (FK → chat_rooms, users, media)
    #   2. chat_room_members (FK → chat_rooms, users)
    #   3. chat_rooms (FK'd by the two above)
    #   4. enums (only after all consuming tables are gone)
    op.drop_table("messages")
    op.drop_table("chat_room_members")
    op.drop_table("chat_rooms")
    sa.Enum(name="chat_member_role").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(name="chat_room_type").drop(op.get_bind(), checkfirst=True)
