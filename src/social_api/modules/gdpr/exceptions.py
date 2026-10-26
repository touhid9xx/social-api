"""GDPR exceptions."""

from __future__ import annotations

from social_api.exceptions import AppError


class GdprError(AppError):
    """Base class for GDPR-related errors."""


class AlreadyScheduledForDeletionError(GdprError):
    code = "ALREADY_SCHEDULED_FOR_DELETION"
    status_code = 409
    default_message = "Account deletion is already scheduled"


class NoActiveDeletionError(GdprError):
    code = "NO_ACTIVE_DELETION"
    status_code = 409
    default_message = "No active deletion request to cancel"
