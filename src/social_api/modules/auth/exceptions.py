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


class EmailNotVerifiedError(AppError):
    """Correct credentials, but the address was never confirmed.

    Raised only *after* the password verified, so it reveals nothing an
    attacker could not already learn by guessing the password. A 403 (not
    401) on purpose: the credentials are valid, the account is simply not
    usable yet — a 401 would send the client down the token-refresh path.
    """

    code = "EMAIL_NOT_VERIFIED"
    status_code = 403
    message = "Confirm your email address to finish signing in"


class InvalidTokenError(AppError):
    code = "INVALID_TOKEN"
    status_code = 401
    message = "Invalid or expired token"


class TokenRevokedError(AppError):
    code = "TOKEN_REVOKED"
    status_code = 401
    message = "Token has been revoked"
