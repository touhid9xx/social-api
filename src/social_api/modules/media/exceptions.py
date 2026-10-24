"""Media module errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class MediaNotFoundError(AppError):
    code = "MEDIA_NOT_FOUND"
    status_code = 404
    message = "Media not found"


class MediaForbiddenError(AppError):
    code = "MEDIA_FORBIDDEN"
    status_code = 403
    message = "You cannot modify this media"


class UnsupportedMediaTypeError(AppError):
    code = "UNSUPPORTED_MEDIA_TYPE"
    status_code = 415
    message = "Unsupported media type"


class MediaTooLargeError(AppError):
    code = "MEDIA_TOO_LARGE"
    status_code = 413
    message = "Media file too large"


class MediaAlreadyAttachedError(AppError):
    code = "MEDIA_ALREADY_ATTACHED"
    status_code = 409
    message = "Media is already attached to another post"


class MediaVirusScanError(AppError):
    code = "MEDIA_VIRUS_SCAN_FAILED"
    status_code = 422
    message = "File failed virus scan"
