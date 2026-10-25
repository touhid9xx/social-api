"""Feed errors."""

from __future__ import annotations

from social_api.exceptions import AppError


class FeedUnavailableError(AppError):
    code = "FEED_UNAVAILABLE"
    status_code = 503
    message = "Feed is temporarily unavailable"
