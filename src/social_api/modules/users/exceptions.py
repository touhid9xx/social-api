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


# ---- Admin account management ----


class SelfActionError(AppError):
    """An admin tried to deactivate, demote or delete their own account.

    Blocked rather than merely discouraged: an admin who deactivates
    themselves loses the console they would need to undo it, and a demote
    is equally one-way from their side. Another admin must do it.
    """

    code = "CANNOT_MODIFY_SELF"
    status_code = 403
    message = "You cannot perform this action on your own account"


class LastAdminError(AppError):
    """The change would leave the system with zero active admins.

    Distinct from chat's `LAST_ADMIN_CANNOT_LEAVE` (a conversation-level
    rule with its own copy) even though the phrasing of the rule is
    similar — sharing the code would tie two unrelated screens to one
    message string.
    """

    code = "LAST_ADMIN_PROTECTED"
    status_code = 409
    message = "At least one active admin account must remain"
