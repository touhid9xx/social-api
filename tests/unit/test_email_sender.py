"""SMTP sender + dispatch hand-off: flag gate, breaker, eager vs Celery."""

from __future__ import annotations

import sys
import types
from collections.abc import Awaitable, Callable
from typing import Any

import aiosmtplib
import pytest

from social_api.config import get_settings
from social_api.core.circuit_breakers import BreakerOpenError
from social_api.email import sender as sender_mod

pytestmark = pytest.mark.unit


class _Flags:
    def __init__(self, *, email: bool = True) -> None:
        self._email = email

    def is_enabled(self, flag: str) -> bool:
        return flag == "email_enabled" and self._email


class _OpenBreaker:
    async def call(self, fn: Callable[[], Awaitable[Any]]) -> Any:
        raise BreakerOpenError("smtp open")


class _PassthroughBreaker:
    """Isolates tests from the process-global smtp_breaker state."""

    async def call(self, fn: Callable[[], Awaitable[Any]]) -> Any:
        return await fn()


class _EagerSettings:
    celery_task_always_eager = True


class _QueuedSettings:
    celery_task_always_eager = False


def _record_smtp(
    monkeypatch: pytest.MonkeyPatch, *, raises: Exception | None = None
) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    async def _fake_send(message: Any, **kwargs: Any) -> None:
        sent.append({"message": message, **kwargs})
        if raises is not None:
            raise raises

    # Patch the real aiosmtplib module object: `sender_mod.aiosmtplib` IS this module.
    monkeypatch.setattr(aiosmtplib, "send", _fake_send)
    return sent


def _record_dispatch(sink: list[dict[str, str]]) -> Callable[..., Awaitable[None]]:
    async def _fake(*, to: str, subject: str, body: str) -> None:
        sink.append({"to": to, "subject": subject, "body": body})

    return _fake


# ---- send_email ----


async def test_send_email_flag_off_skips_without_touching_smtp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags(email=False))
    sent = _record_smtp(monkeypatch)

    result = await sender_mod.send_email(to="a@b.test", subject="Hi", body="Body")

    assert result is False
    assert sent == []


async def test_send_email_success_uses_configured_smtp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "smtp_breaker", _PassthroughBreaker())
    sent = _record_smtp(monkeypatch)

    result = await sender_mod.send_email(to="a@b.test", subject="Hi", body="Body")

    assert result is True
    assert len(sent) == 1
    settings = get_settings()
    assert sent[0]["hostname"] == settings.smtp_host
    assert sent[0]["port"] == settings.smtp_port
    assert sent[0]["timeout"] == settings.smtp_timeout_seconds

    message = sent[0]["message"]
    assert message["To"] == "a@b.test"
    assert message["From"] == settings.smtp_from
    assert message["Subject"] == "Hi"
    assert "Body" in message.get_content()


async def test_send_email_open_breaker_fast_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "smtp_breaker", _OpenBreaker())
    sent = _record_smtp(monkeypatch)

    result = await sender_mod.send_email(to="a@b.test", subject="Hi", body="Body")

    assert result is False
    assert sent == []


async def test_send_email_propagates_smtp_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "smtp_breaker", _PassthroughBreaker())
    _record_smtp(monkeypatch, raises=OSError("smtp down"))

    with pytest.raises(OSError, match="smtp down"):
        await sender_mod.send_email(to="a@b.test", subject="Hi", body="Body")


# ---- dispatch_email ----


async def test_dispatch_email_flag_off_sends_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[dict[str, str]] = []
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags(email=False))
    monkeypatch.setattr(sender_mod, "send_email", _record_dispatch(called))

    await sender_mod.dispatch_email(to="a@b.test", subject="Hi", body="Body")

    assert called == []


async def test_dispatch_email_sends_inline_when_eager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[dict[str, str]] = []
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "get_settings", lambda: _EagerSettings())
    monkeypatch.setattr(sender_mod, "send_email", _record_dispatch(called))

    await sender_mod.dispatch_email(to="a@b.test", subject="Hi", body="Body")

    assert called == [{"to": "a@b.test", "subject": "Hi", "body": "Body"}]


async def test_dispatch_email_enqueues_celery_task_when_not_eager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueued: list[dict[str, str]] = []
    fake_module = types.ModuleType("social_api.workers.tasks.email")
    fake_module.send_email = types.SimpleNamespace(  # type: ignore[attr-defined]
        delay=lambda **kwargs: enqueued.append(kwargs)
    )
    monkeypatch.setitem(sys.modules, "social_api.workers.tasks.email", fake_module)
    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "get_settings", lambda: _QueuedSettings())

    await sender_mod.dispatch_email(to="a@b.test", subject="Hi", body="Body")

    assert enqueued == [{"to": "a@b.test", "subject": "Hi", "body": "Body"}]


async def test_dispatch_email_never_raises_when_delivery_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _boom(*, to: str, subject: str, body: str) -> None:
        raise OSError("smtp down")

    monkeypatch.setattr(sender_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sender_mod, "get_settings", lambda: _EagerSettings())
    monkeypatch.setattr(sender_mod, "send_email", _boom)

    # A transactional email must never fail registration / password reset.
    await sender_mod.dispatch_email(to="a@b.test", subject="Hi", body="Body")
