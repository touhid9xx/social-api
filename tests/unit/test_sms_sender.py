"""Optional SMS channel (textbee): flag gate, config gate, breaker, PII masking."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest

from social_api.core.circuit_breakers import BreakerOpenError
from social_api.email import sms as sms_mod
from social_api.email.sms import MAX_SMS_CHARS

pytestmark = pytest.mark.unit


class _Flags:
    def __init__(self, *, sms: bool = True) -> None:
        self._sms = sms

    def is_enabled(self, flag: str) -> bool:
        return flag == "sms_enabled" and self._sms


class _Configured:
    textbee_base_url = "https://api.textbee.test/api/v1"
    textbee_api_key = "key-123"
    textbee_device_id = "dev-9"
    sms_timeout_seconds = 5.0


class _Unconfigured:
    textbee_base_url = "https://api.textbee.test/api/v1"
    textbee_api_key = ""
    textbee_device_id = ""
    sms_timeout_seconds = 5.0


class _OpenBreaker:
    async def call(self, fn: Callable[[], Awaitable[Any]]) -> Any:
        raise BreakerOpenError("sms open")


class _PassthroughBreaker:
    async def call(self, fn: Callable[[], Awaitable[Any]]) -> Any:
        return await fn()


class _Response:
    def __init__(self, *, error: Exception | None = None) -> None:
        self._error = error

    def raise_for_status(self) -> None:
        if self._error is not None:
            raise self._error


class _Client:
    """Minimal stand-in for `httpx.AsyncClient` (async context manager + post)."""

    def __init__(
        self, captured: dict[str, Any], response: _Response, *, timeout: Any = None
    ) -> None:
        self._captured = captured
        self._response = response
        captured["timeout"] = timeout

    async def __aenter__(self) -> _Client:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def post(self, url: str, **kwargs: Any) -> _Response:
        self._captured["url"] = url
        self._captured.update(kwargs)
        return self._response


def _patch_http(
    monkeypatch: pytest.MonkeyPatch, *, error: Exception | None = None
) -> dict[str, Any]:
    captured: dict[str, Any] = {}
    response = _Response(error=error)

    def _factory(**kwargs: Any) -> _Client:
        return _Client(captured, response, timeout=kwargs.get("timeout"))

    # Patch the real httpx module object: `sms_mod.httpx` IS this module.
    monkeypatch.setattr(httpx, "AsyncClient", _factory)
    return captured


async def test_send_sms_flag_off_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags(sms=False))
    captured = _patch_http(monkeypatch)

    assert await sms_mod.send_sms(to="+8801000000067", body="hi") is False
    assert captured == {}


async def test_send_sms_without_credentials_skips(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sms_mod, "get_settings", lambda: _Unconfigured())
    captured = _patch_http(monkeypatch)

    # Flag on but no credentials: configuration error, not an outage.
    assert await sms_mod.send_sms(to="+8801000000067", body="hi") is False
    assert captured == {}


async def test_send_sms_posts_to_textbee_device_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sms_mod, "get_settings", lambda: _Configured())
    monkeypatch.setattr(sms_mod, "sms_breaker", _PassthroughBreaker())
    captured = _patch_http(monkeypatch)

    assert await sms_mod.send_sms(to="+8801000000067", body="hello") is True

    assert captured["url"] == ("https://api.textbee.test/api/v1/gateway/devices/dev-9/send-sms")
    assert captured["json"] == {"recipients": ["+8801000000067"], "message": "hello"}
    assert captured["headers"] == {"x-api-key": "key-123"}
    assert captured["timeout"] == 5.0


async def test_send_sms_truncates_to_single_segment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sms_mod, "get_settings", lambda: _Configured())
    monkeypatch.setattr(sms_mod, "sms_breaker", _PassthroughBreaker())
    captured = _patch_http(monkeypatch)

    await sms_mod.send_sms(to="+8801000000067", body="x" * 500)

    assert len(captured["json"]["message"]) == MAX_SMS_CHARS


async def test_send_sms_open_breaker_fast_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sms_mod, "get_settings", lambda: _Configured())
    monkeypatch.setattr(sms_mod, "sms_breaker", _OpenBreaker())
    captured = _patch_http(monkeypatch)

    assert await sms_mod.send_sms(to="+8801000000067", body="hi") is False
    assert captured == {}


async def test_send_sms_propagates_gateway_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sms_mod, "get_flags", lambda: _Flags())
    monkeypatch.setattr(sms_mod, "get_settings", lambda: _Configured())
    monkeypatch.setattr(sms_mod, "sms_breaker", _PassthroughBreaker())
    _patch_http(monkeypatch, error=RuntimeError("gateway 500"))

    with pytest.raises(RuntimeError, match="gateway 500"):
        await sms_mod.send_sms(to="+8801000000067", body="hi")


async def test_dispatch_sms_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _boom(*, to: str, body: str) -> None:
        raise RuntimeError("gateway down")

    monkeypatch.setattr(sms_mod, "send_sms", _boom)

    await sms_mod.dispatch_sms(to="+8801000000067", body="hi")


def test_masked_phone_keeps_only_last_two_digits() -> None:
    assert sms_mod._masked("+8801000000067") == "***67"
    assert sms_mod._masked("") == "***"
    assert "8801000000067" not in sms_mod._masked("+8801000000067")
