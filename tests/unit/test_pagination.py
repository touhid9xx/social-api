"""Cursor pagination: round-trip, tamper detection, limit clamping."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from social_api.core.pagination import (
    PaginationError,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)

pytestmark = pytest.mark.unit


def test_roundtrip_simple() -> None:
    vals = [1234567890, 42]
    tok = encode_cursor(vals)
    assert decode_cursor(tok) == vals


def test_roundtrip_datetime() -> None:
    dt = datetime(2024, 1, 15, 10, 30, 45, 123456, tzinfo=UTC)
    tok = encode_cursor([dt, 7])
    out = decode_cursor(tok)
    assert out[0].startswith("2024-01-15T10:30:45.123456")
    assert out[1] == 7


def test_naive_datetime_becomes_utc() -> None:
    dt = datetime(2024, 1, 15, 10, 30, 45)
    tok = encode_cursor([dt])
    out = decode_cursor(tok)
    assert out[0].endswith("+00:00")


def test_cursor_is_opaque() -> None:
    tok = encode_cursor([1, 2, 3])
    # Should not leak raw values in plaintext
    assert "1,2,3" not in tok


def test_tampered_body_rejected() -> None:
    tok = encode_cursor([1, 2])
    body, sig = tok.rsplit(".", 1)
    # Flip a char in body
    tampered = ("A" if body[0] != "A" else "B") + body[1:] + "." + sig
    with pytest.raises(PaginationError):
        decode_cursor(tampered)


def test_tampered_signature_rejected() -> None:
    tok = encode_cursor([1, 2])
    body, _sig = tok.rsplit(".", 1)
    with pytest.raises(PaginationError):
        decode_cursor(body + ".AAAAAAAAAAAAAAAAAAAAAA")


def test_malformed_no_sep() -> None:
    with pytest.raises(PaginationError):
        decode_cursor("notacursor")


def test_malformed_empty() -> None:
    with pytest.raises(PaginationError):
        decode_cursor("")


def test_unsupported_value_type() -> None:
    with pytest.raises(PaginationError):
        encode_cursor([{"nested": "dict"}])


@pytest.mark.parametrize(
    ("limit", "expected"),
    [
        (None, 20),
        (0, 1),
        (-5, 1),
        (1, 1),
        (50, 50),
        (100, 100),
        (101, 100),
        (9999, 100),
    ],
)
def test_clamp_limit(limit: int | None, expected: int) -> None:
    assert clamp_limit(limit) == expected
