"""Audit service — write with PII redaction, list with filters."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from social_api.exceptions import BadRequestError
from social_api.logging_config import PII_KEYS, REDACTED, get_logger
from social_api.modules.audit.models import AuditLog
from social_api.modules.audit.repository import AuditRepository
from social_api.modules.audit.schemas import AuditLogView, AuditPage

logger = get_logger(__name__)


# Additional keys audited-sensitive beyond the log deny-list
_EXTRA_REDACT = frozenset(
    {
        "password_hash",
        "new_password",
        "old_password",
        "reset_token",
        "verification_token",
    }
)

_ALL_REDACT = PII_KEYS | _EXTRA_REDACT


def _redact_value(value: Any, _key: str | None = None) -> Any:
    """
    Recursively redact PII keys. Scalars are returned as-is except when the
    key at the call site is a PII key (handled by _redact_dict).
    """
    if isinstance(value, dict):
        return _redact_dict(value)
    if isinstance(value, list):
        return [_redact_value(v) for v in value]
    return value


def _redact_dict(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        if k.lower() in _ALL_REDACT:
            out[k] = REDACTED
        else:
            out[k] = _redact_value(v)
    return out


def redact_payload(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if payload is None:
        return None
    return _redact_dict(payload)


def _to_view(row: AuditLog) -> AuditLogView:
    return AuditLogView(
        id=row.id,
        actor_id=row.actor_id,
        action=row.action,
        entity=row.entity,
        entity_id=row.entity_id,
        before=row.before,
        after=row.after,
        ip=row.ip,
        user_agent=row.user_agent,
        request_id=row.request_id,
        created_at=row.created_at,
    )


class AuditService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = AuditRepository(session)

    async def write(
        self,
        *,
        actor_id: int | None,
        action: str,
        entity: str,
        entity_id: int | None = None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
    ) -> None:
        """
        Write an audit row. PII-redacts before/after. Best-effort — never
        raises (caller must not fail due to audit).
        """
        try:
            ctx = structlog.contextvars.get_contextvars()
            ip = ctx.get("client_ip")
            ua = ctx.get("user_agent")
            rid = ctx.get("request_id")

            await self._repo.create(
                actor_id=actor_id,
                action=action,
                entity=entity,
                entity_id=entity_id,
                before=redact_payload(before),
                after=redact_payload(after),
                ip=str(ip)[:45] if ip else None,
                user_agent=str(ua) if ua else None,
                request_id=str(rid) if rid else None,
            )
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning(
                "audit_write_failed",
                action=action,
                entity=entity,
                entity_id=entity_id,
                error=type(exc).__name__,
            )

    async def list_logs(
        self,
        *,
        actor_id: int | None,
        action_filter: str | None,
        entity_filter: str | None,
        entity_id_filter: int | None,
        cursor: str | None,
        limit: int | None,
    ) -> AuditPage:
        lmt = clamp_limit(limit)

        cts: datetime | None = None
        cid: int | None = None
        if cursor:
            try:
                vals = decode_cursor(cursor)
                cts = datetime.fromisoformat(vals[0])
                cid = int(vals[1])
            except (PaginationError, ValueError, IndexError):
                raise BadRequestError("Invalid cursor", detail={"code": "INVALID_CURSOR"}) from None

        rows = await self._repo.list_logs(
            actor_id=actor_id,
            action_filter=action_filter,
            entity_filter=entity_filter,
            entity_id_filter=entity_id_filter,
            cursor_ts=cts,
            cursor_id=cid,
            limit=lmt,
        )

        next_cursor: str | None = None
        if len(rows) > lmt:
            rows = rows[:lmt]
            last = rows[-1]
            next_cursor = encode_cursor([last.created_at, last.id])

        return AuditPage(items=[_to_view(r) for r in rows], next_cursor=next_cursor)
