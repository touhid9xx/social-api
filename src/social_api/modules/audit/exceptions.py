"""Audit errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class AuditForbiddenError(AppError):
    code = "AUDIT_FORBIDDEN"
    status_code = 403
    message = "You do not have access to this audit trail"
