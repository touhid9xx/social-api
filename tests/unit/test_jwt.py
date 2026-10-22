"""JWT issue/verify + refresh rotation semantics."""

from __future__ import annotations

import jwt
import pytest

from social_api.core.security import (
    ACCESS,
    REFRESH,
    decode_token,
    issue_access_token,
    issue_refresh_token,
)

pytestmark = pytest.mark.unit


def test_access_token_roundtrip() -> None:
    token, jti, _ = issue_access_token(user_id=42, role="user")
    payload = decode_token(token, expected_type=ACCESS)
    assert payload["sub"] == "42"
    assert payload["jti"] == jti
    assert payload["type"] == "access"
    assert payload["role"] == "user"


def test_refresh_token_roundtrip() -> None:
    token, _jti, _ = issue_refresh_token(user_id=7, role="admin")
    payload = decode_token(token, expected_type=REFRESH)
    assert payload["type"] == "refresh"
    assert payload["role"] == "admin"


def test_wrong_type_rejected() -> None:
    access, _, _ = issue_access_token(user_id=1, role="user")
    with pytest.raises(jwt.PyJWTError):
        decode_token(access, expected_type=REFRESH)


def test_tampered_token_rejected() -> None:
    token, _, _ = issue_access_token(user_id=1, role="user")
    # flip a character mid-string (still valid base64 shape)
    tampered = token[:-2] + ("AA" if token[-2:] != "AA" else "BB")
    with pytest.raises(jwt.PyJWTError):
        decode_token(tampered, expected_type=ACCESS)
