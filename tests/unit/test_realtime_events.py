"""Event envelope build/parse."""

from __future__ import annotations

import pytest

from social_api.realtime.events import build_event, parse_event

pytestmark = pytest.mark.unit


def test_build_pong() -> None:
    s = build_event(type_="pong")
    assert '"type":"pong"' in s


def test_build_with_data() -> None:
    s = build_event(type_="notification", data={"id": 1})
    assert '"notification"' in s
    assert '"id":1' in s


def test_parse_valid() -> None:
    assert parse_event('{"type":"ping"}') == {"type": "ping"}


def test_parse_ignores_non_json() -> None:
    assert parse_event("not json") is None


def test_parse_requires_type() -> None:
    assert parse_event('{"data":1}') is None


def test_parse_bytes_like() -> None:
    # Simulating a malformed server response; still returns None
    assert parse_event("[1, 2, 3]") is None
