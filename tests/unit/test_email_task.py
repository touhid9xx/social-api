"""`email.send` Celery task: delivery, skip, and retry-on-SMTP-failure.

`send_email` (the producer surface) is covered in `test_email_sender.py`;
this module covers the *worker* side — what happens once Celery actually
runs the task in a worker process, including the retry path.
"""

from __future__ import annotations

from typing import Any

import pytest

from social_api.email import sender as sender_mod
from social_api.workers.tasks import email as task_mod

pytestmark = pytest.mark.unit

_TO = "alice@example.com"
_SUBJECT = "Verify your email"
_BODY = "click the link"


class _RetriedError(Exception):
    """Stands in for Celery's `Retry` — `Task.retry()` raises to unwind."""


class _Request:
    def __init__(self, retries: int) -> None:
        self.retries = retries


class _Task:
    """The bound Celery Task (`self`) injected by `bind=True`."""

    def __init__(self, *, retries: int = 0) -> None:
        self.request = _Request(retries)
        self.retried_with: list[BaseException] = []

    def retry(self, *, exc: BaseException) -> Any:
        self.retried_with.append(exc)
        raise _RetriedError from exc


def _sent(*, to: str, subject: str, body: str) -> dict[str, str]:
    return {"to": to, "subject": subject, "body": body}


def test_task_is_registered_as_email_send() -> None:
    """The name is a contract: `dispatch_email` enqueues by this exact string."""
    assert task_mod._untyped_task.name == "email.send"


def test_task_is_bound_and_has_retry_budget() -> None:
    assert task_mod._untyped_task.max_retries == task_mod.MAX_RETRIES
    assert task_mod._untyped_task.default_retry_delay == task_mod.RETRY_DELAY_SECONDS


@pytest.mark.asyncio
async def test_do_send_delegates_to_sender(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, str]] = []

    async def fake_send(*, to: str, subject: str, body: str) -> bool:
        captured.append(_sent(to=to, subject=subject, body=body))
        return True

    monkeypatch.setattr(sender_mod, "send_email", fake_send)

    assert await task_mod._do_send(to=_TO, subject=_SUBJECT, body=_BODY) is True
    assert captured == [_sent(to=_TO, subject=_SUBJECT, body=_BODY)]


def test_task_reports_sent_on_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_send(*, to: str, subject: str, body: str) -> bool:
        return True

    monkeypatch.setattr(sender_mod, "send_email", fake_send)

    out = task_mod._send_email(_Task(), to=_TO, subject=_SUBJECT, body=_BODY)
    assert out == {"status": "sent"}


def test_task_reports_skipped_when_sender_declines(monkeypatch: pytest.MonkeyPatch) -> None:
    """False means "not delivered" (feature flag off / breaker open), not an error."""

    async def fake_send(*, to: str, subject: str, body: str) -> bool:
        return False

    monkeypatch.setattr(sender_mod, "send_email", fake_send)

    out = task_mod._send_email(_Task(), to=_TO, subject=_SUBJECT, body=_BODY)
    assert out == {"status": "skipped"}


def test_task_retries_with_the_original_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """SMTP failures must reach `self.retry`, not escape as a raw exception."""

    async def boom(*, to: str, subject: str, body: str) -> bool:
        raise OSError("smtp unreachable")

    monkeypatch.setattr(sender_mod, "send_email", boom)

    task = _Task(retries=2)
    with pytest.raises(_RetriedError):
        task_mod._send_email(task, to=_TO, subject=_SUBJECT, body=_BODY)

    assert len(task.retried_with) == 1
    assert isinstance(task.retried_with[0], OSError)
