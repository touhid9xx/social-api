"""Transactional email worker task (`email.send`).

The API layer hands messages here via `social_api.email.sender.dispatch_email`
so SMTP latency and outages never sit in the request path.
"""

from __future__ import annotations

import asyncio
from typing import Any, Protocol

from social_api.logging_config import get_logger
from social_api.workers.celery_app import celery_app

logger = get_logger(__name__)

MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 60


class EmailSendTask(Protocol):
    """Producer-side view of the `email.send` task.

    Celery ships no type hints, so `celery_app.task()` hands back an untyped
    callable and type checkers cannot see `.delay()`. This protocol states the
    exact surface the API layer needs to enqueue one email, keeping the
    untyped Celery boundary inside this module.
    """

    def delay(self, *, to: str, subject: str, body: str) -> object: ...


async def _do_send(*, to: str, subject: str, body: str) -> bool:
    # Imported through the module (not the function) so tests can patch
    # `social_api.email.sender.send_email` and intercept delivery.
    from social_api.email import sender

    return await sender.send_email(to=to, subject=subject, body=body)


def _send_email(self: Any, *, to: str, subject: str, body: str) -> dict[str, str]:
    """Send one email; retry with backoff while SMTP is failing."""
    try:
        # asyncio.run() is safe here: a Celery worker process has no loop.
        sent = asyncio.run(_do_send(to=to, subject=subject, body=body))
    except Exception as exc:
        logger.warning(
            "email_task_retrying",
            error=type(exc).__name__,
            retries=int(self.request.retries),
        )
        raise self.retry(exc=exc) from exc
    return {"status": "sent" if sent else "skipped"}


# Built from the body function instead of `@celery_app.task(...)`: decorating
# with the untyped factory makes type checkers fall back to the plain wrapped
# function shape and lose `.delay()` entirely.
#
# Step 1 keeps the untyped factory boundary in one place (Celery ships no type
# hints, so its static type is deliberately erased here)…
_untyped_task: Any = celery_app.task(
    name="email.send",
    bind=True,
    max_retries=MAX_RETRIES,
    default_retry_delay=RETRY_DELAY_SECONDS,
)(_send_email)

# Step 2 re-publishes that object through the typed producer surface, so callers
# such as `email.sender.dispatch_email` get a checked `.delay(...)` signature.
send_email: EmailSendTask = _untyped_task
