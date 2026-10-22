"""Users module errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class ProfileNotFoundError(AppError):
    code = "PROFILE_NOT_FOUND"
    status_code = 404
    message = "Profile not found"


class ProfileVisibilityError(AppError):
    code = "PROFILE_NOT_VISIBLE"
    status_code = 403
    message = "This profile is not visible to you"


class OptimisticLockError(AppError):
    code = "VERSION_CONFLICT"
    status_code = 409
    message = "Record was updated by another request"


class ConsentNotFoundError(AppError):
    code = "CONSENT_NOT_FOUND"
    status_code = 404
    message = "Active consent not found"
