"""Alembic environment — async-aware. Migrations land in M3+."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from social_api.config import get_settings
from social_api.db.base import Base

# ─────────────────────────────────────────────────────────────────────────
# CRITICAL: import EVERY model module BEFORE `target_metadata = Base.metadata`
# below. Model modules register their tables with `Base.metadata` on import;
# if a module isn't imported here, its table appears "missing from metadata"
# and `alembic revision --autogenerate` emits a migration that DROPS it.
#
# This exact bug dropped the `users` table on 2026-10-22 (autogenerate saw
# metadata={} vs db={users} → "Detected removed table 'users'" → DROP TABLE).
#
# At M5, add each model module here. At M6 we'll consolidate into a single
# `social_api.models` registry module so `env.py` never needs touching again.
# ─────────────────────────────────────────────────────────────────────────
from social_api.modules.auth import models as _auth_models  # noqa: F401
from social_api.modules.users import models as _users_models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override URL from settings
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata   # NOW populated: users, profiles, user_consent


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
