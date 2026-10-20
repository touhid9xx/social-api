"""Verify structlog never leaks PII."""

from __future__ import annotations

import json
from typing import Any

import pytest

from social_api.logging_config import (
    PII_KEYS,
    REDACTED,
    _redact_pii,
    configure_logging,
    get_logger,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# 1. Processor-level unit test (no global structlog state touched)
# ---------------------------------------------------------------------------


def test_redact_pii_scrubs_top_level_keys() -> None:
    event: dict[str, Any] = {
        "event": "login_attempt",
        "email": "secret@example.com",
        "password": "SuperSecret123!",
        "access_token": "eyJxxx",
        "refresh_token": "rt-abc",
        "authorization": "Bearer xyz",
        "user_id": 42,
    }
    out = _redact_pii(None, "info", event)

    assert out["email"] == REDACTED
    assert out["password"] == REDACTED
    assert out["access_token"] == REDACTED
    assert out["refresh_token"] == REDACTED
    assert out["authorization"] == REDACTED
    # Non-PII must survive
    assert out["user_id"] == 42
    assert out["event"] == "login_attempt"


def test_redact_pii_scrubs_nested_dicts_one_level() -> None:
    event: dict[str, Any] = {
        "event": "http_request",
        "headers": {
            "Authorization": "Bearer xyz",  # case-insensitive match
            "Cookie": "session=abc",
            "User-Agent": "curl/8",  # not PII
        },
    }
    out = _redact_pii(None, "info", event)
    headers = out["headers"]
    assert headers["Authorization"] == REDACTED
    assert headers["Cookie"] == REDACTED
    assert headers["User-Agent"] == "curl/8"


def test_redact_pii_covers_all_deny_list_keys_case_insensitively() -> None:
    for key in PII_KEYS:
        event = {key: "leak-me", "event": "test"}
        out = _redact_pii(None, "info", event)
        assert out[key] == REDACTED, f"key {key!r} was not redacted"
        # also uppercase variant
        event_upper = {key.upper(): "leak-me", "event": "test"}
        out_upper = _redact_pii(None, "info", event_upper)
        assert out_upper[key.upper()] == REDACTED, f"key {key.upper()!r} was not redacted"


# ---------------------------------------------------------------------------
# 2. End-to-end: the *real* configure_logging() pipeline must redact
# ---------------------------------------------------------------------------


def test_configure_logging_redacts_pii_in_json_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """
    Exercise the actual configured pipeline (not a copy of it).

    Strategy: force JSON + DEBUG, call configure_logging(), log through the
    public get_logger(), then parse captured stdout as JSON and assert PII
    values are gone. This catches:
      - someone removing _redact_pii from the processor chain
      - someone reordering processors so PII arrives after the renderer
    """
    monkeypatch.setenv("LOG_FORMAT", "json")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")

    from social_api.config import get_settings

    get_settings.cache_clear()

    try:
        configure_logging()

        # capsys captures what structlog's PrintLogger writes to stdout
        logger = get_logger("pii.test")
        logger.info(
            "login_attempt",
            email="secret@example.com",
            password="SuperSecret123!",
            access_token="eyJxxx",
            user_id=42,
        )

        captured = capsys.readouterr()
        output = captured.out

        assert output, "expected log output on stdout"
        assert "secret@example.com" not in output
        assert "SuperSecret123!" not in output
        assert "eyJxxx" not in output
        assert REDACTED in output
        assert "42" in output

        # At least one line must be valid JSON with the log level
        json_lines = [ln for ln in output.splitlines() if ln.strip().startswith("{")]
        assert json_lines, "expected at least one JSON log line"
        parsed = json.loads(json_lines[0])
        assert parsed["event"] == "login_attempt"
        assert parsed["user_id"] == 42
    finally:
        # Restore real config for other tests
        get_settings.cache_clear()
        monkeypatch.undo()
        configure_logging()
