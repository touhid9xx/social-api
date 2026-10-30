"""Plain-text email delivery via SMTP, guarded by `smtp_breaker`.

Two layers:

    send_email()     -- does the I/O (aiosmtplib) behind the breaker.
    dispatch_email() -- flag gate + hand-off (inline in eager mode, else
                        enqueue the `email.send` Celery task).

`dispatch_email()` NEVER raises: a transactional email must not fail
registration or a password-reset request. Failures are logged and
counted instead.
"""

from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib

from social_api.config import get_settings
from social_api.core.circuit_breakers import BreakerOpenError, smtp_breaker
from social_api.core.feature_flags import get_flags
from social_api.logging_config import get_logger

logger = get_logger(__name__)


def _count(result: str) -> None:
    """Best-effort metric; a Prometheus hiccup must never break sending."""
    try:
        from social_api.observability.metrics import outbound_message_total

        outbound_message_total.labels(channel="email", result=result).inc()
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug("email_metric_failed", error=type(exc).__name__)


async def send_email(*, to: str, subject: str, body: str) -> bool:
    """Send one plain-text email.

    Returns True when SMTP accepted the message, False when the send was
    skipped (feature flag off / breaker open). Re-raises real SMTP errors
    so the Celery task can retry with backoff.
    """
    if not get_flags().is_enabled("email_enabled"):
        logger.info("email_skipped_flag_disabled")
        _count("skipped")
        return False

    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    async def _deliver() -> None:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password or None,
            start_tls=settings.smtp_tls,
            timeout=settings.smtp_timeout_seconds,
        )

    try:
        await smtp_breaker.call(_deliver)
    except BreakerOpenError:
        # Fast-fail: SMTP is already known-bad. Retrying now is pointless.
        logger.warning("email_send_breaker_open")
        _count("skipped")
        return False
    except Exception as exc:
        logger.warning("email_send_failed", error=type(exc).__name__)
        _count("failed")
        raise

    logger.info("email_sent")
    _count("sent")
    return True


async def dispatch_email(*, to: str, subject: str, body: str) -> None:
    """Flag-gated, never-raising hand-off of one email for delivery."""
    if not get_flags().is_enabled("email_enabled"):
        logger.info("email_dispatch_skipped_flag_disabled")
        _count("skipped")
        return

    settings = get_settings()

    # Eager mode (tests / single-process dev) has no worker AND we are
    # already inside a running event loop, so the task's asyncio.run()
    # would raise RuntimeError. Deliver inline instead.
    if settings.celery_task_always_eager:
        try:
            await send_email(to=to, subject=subject, body=body)
        except Exception as exc:
            logger.warning("email_inline_send_failed", error=type(exc).__name__)
        return

    try:
        # Imported lazily: workers pull in Celery, and the API layer only
        # needs it when it actually has something to enqueue.
        from social_api.workers.tasks.email import send_email as send_email_task

        send_email_task.delay(to=to, subject=subject, body=body)
    except Exception as exc:
        logger.warning("email_enqueue_failed", error=type(exc).__name__)
        _count("enqueue_failed")
