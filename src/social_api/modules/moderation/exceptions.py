"""Moderation errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class ReportNotFoundError(AppError):
    code = "REPORT_NOT_FOUND"
    status_code = 404
    message = "Report not found"


class ReportTargetNotFoundError(AppError):
    code = "REPORT_TARGET_NOT_FOUND"
    status_code = 404
    message = "Report target does not exist"


class CannotReportSelfError(AppError):
    code = "CANNOT_REPORT_SELF"
    status_code = 400
    message = "You cannot report your own content"


class ReportAlreadyExistsError(AppError):
    code = "REPORT_ALREADY_EXISTS"
    status_code = 409
    message = "You already reported this today"


class ReportStatusTransitionError(AppError):
    code = "REPORT_STATUS_TRANSITION"
    status_code = 409
    message = "Invalid report status transition"


class ReportLockedError(AppError):
    code = "REPORT_LOCKED"
    status_code = 409
    message = "Report is already resolved/dismissed"
