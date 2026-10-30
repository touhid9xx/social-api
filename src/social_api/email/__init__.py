"""Transactional outbound channels: email (SMTP) and optional SMS.

Both channels share the same shape — a `send_*` coroutine that does the
actual I/O behind a circuit breaker, and a `dispatch_*` coroutine that
gates on the feature flag and hands the message off for delivery.
"""

from __future__ import annotations

from social_api.email.sender import dispatch_email, send_email
from social_api.email.sms import dispatch_sms, send_sms
from social_api.email.templates import (
    EmailContent,
    render_notification_digest,
    render_password_reset,
    render_verification,
)

__all__ = [
    "EmailContent",
    "dispatch_email",
    "dispatch_sms",
    "render_notification_digest",
    "render_password_reset",
    "render_verification",
    "send_email",
    "send_sms",
]
