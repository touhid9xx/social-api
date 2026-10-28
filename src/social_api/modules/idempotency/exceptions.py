"""Idempotency exceptions."""

from __future__ import annotations

from social_api.exceptions import AppError


class IdempotencyError(AppError):
    """Base for idempotency-layer errors."""


class IdempotencyConflictError(IdempotencyError):
    code = "IDEMPOTENCY_KEY_CONFLICT"
    status_code = 409
    default_message = (
        "Idempotency-Key was used with a different request body. "
        "Use a unique key per unique request."
    )


class IdempotencyInProgressError(IdempotencyError):
    code = "IDEMPOTENCY_KEY_IN_PROGRESS"
    status_code = 409
    default_message = (
        "Another request with this Idempotency-Key is still being processed. Retry after a moment."
    )
