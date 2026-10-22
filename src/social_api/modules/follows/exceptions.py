"""Follows module errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class CannotFollowSelfError(AppError):
    code = "CANNOT_FOLLOW_SELF"
    status_code = 400
    message = "You cannot follow yourself"


class UserBlockedError(AppError):
    code = "USER_BLOCKED"
    status_code = 403
    message = "You cannot interact with this user"


class FollowTargetNotFoundError(AppError):
    code = "FOLLOW_TARGET_NOT_FOUND"
    status_code = 404
    message = "Target user not found"
