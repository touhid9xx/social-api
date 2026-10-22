"""Async DB session factory + FastAPI dependency + health probe.

M3 enhancements:
  - `init_engine()` / `dispose_engine()` wired into app lifespan.
  - `ping_db()` returns (ok, latency_ms, error) for /health/db.
  - `get_db()` still yields a session and is commit/rollback-safe.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Final

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None

_DB_PING_TIMEOUT_SECONDS: Final[float] = 3.0


def init_engine() -> AsyncEngine:
    """Create the global async engine (idempotent). Called from lifespan."""
    global _engine, _sessionmaker
    if _engine is not None:
        return _engine

    settings = get_settings()
    _engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        pool_timeout=30,
        future=True,
    )
    _sessionmaker = async_sessionmaker(
        bind=_engine,
        expire_on_commit=False,
        autoflush=False,
    )
    logger.info("db_engine_initialized", pool_size=10, max_overflow=20)
    return _engine


async def dispose_engine() -> None:
    """Dispose the engine. Called from lifespan shutdown."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
        logger.info("db_engine_disposed")
    _engine = None
    _sessionmaker = None


def get_engine() -> AsyncEngine:
    if _engine is None:
        return init_engine()
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        init_engine()
    assert _sessionmaker is not None  # noqa: S101 — invariant after init
    return _sessionmaker


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yields session; commits on success; rolls back on error."""
    sm = get_sessionmaker()
    async with sm() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def ping_db() -> tuple[bool, float, str | None]:
    """
    Readiness probe: run `SELECT 1`.

    Returns (ok, latency_ms, error_message).
    Never raises — always reports so /health/ready can aggregate.
    """
    start = time.perf_counter()
    try:
        engine = get_engine()
        # Use a short-lived connection with explicit timeout via asyncio.wait_for
        import asyncio

        async def _do_ping() -> None:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

        await asyncio.wait_for(_do_ping(), timeout=_DB_PING_TIMEOUT_SECONDS)
        elapsed_ms = (time.perf_counter() - start) * 1000
        return True, round(elapsed_ms, 2), None
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start) * 1000
        # Don't log full exc at ERROR every readiness poll; use DEBUG
        logger.debug("db_ping_failed", error_type=type(exc).__name__)
        return False, round(elapsed_ms, 2), type(exc).__name__
