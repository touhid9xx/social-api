# src/social_api/db/helpers.py
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Executable


async def execute_dml(session: AsyncSession, stmt: Executable) -> int:
    """Execute a DML statement (UPDATE/DELETE) and return rowcount.

    SQLAlchemy 2.0's `session.execute()` returns `Result[Any]`, which does
    not expose `.rowcount` in its typed interface — only `CursorResult` does.
    This helper encapsulates the cast so call sites stay clean.
    """
    res = await session.execute(stmt)
    # For DML, session.execute returns CursorResult (which has .rowcount).
    # The type system just can't narrow Result → CursorResult automatically.
    return int(getattr(res, "rowcount", 0) or 0)
