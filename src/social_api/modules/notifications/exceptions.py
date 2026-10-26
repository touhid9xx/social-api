"""Notifications errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class NotificationNotFoundError(AppError):
    code = "NOTIFICATION_NOT_FOUND"
    status_code = 404
    message = "Notification not found"


class NotificationForbiddenError(AppError):
    code = "NOTIFICATION_FORBIDDEN"
    status_code = 403
    message = "You cannot modify this notification"
