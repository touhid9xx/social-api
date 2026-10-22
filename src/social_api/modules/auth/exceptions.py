"""Auth-specific errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class InvalidCredentialsError(AppError):
    code = "INVALID_CREDENTIALS"
    status_code = 401
    message = "Invalid email or password"


class EmailAlreadyRegisteredError(AppError):
    code = "EMAIL_ALREADY_REGISTERED"
    status_code = 409
    message = "Email is already registered"


class InactiveUserError(AppError):
    code = "INACTIVE_USER"
    status_code = 403
    message = "Account is inactive"


class InvalidTokenError(AppError):
    code = "INVALID_TOKEN"
    status_code = 401
    message = "Invalid or expired token"


class TokenRevokedError(AppError):
    code = "TOKEN_REVOKED"
    status_code = 401
    message = "Token has been revoked"
