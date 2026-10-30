"""Self-contained verify/reset JWT tokens (no DB table, single-use reset)."""

from __future__ import annotations

import jwt
import pytest

from social_api.config import get_settings
from social_api.core.security import (
    ACCESS,
    RESET,
    VERIFY,
    decode_token,
    issue_access_token,
    issue_password_reset_token,
    issue_verification_token,
    password_fingerprint,
)

pytestmark = pytest.mark.unit


def test_verification_token_roundtrip() -> None:
    token, jti, _expires = issue_verification_token(user_id=42, role="user")

    payload = decode_token(token, expected_type=VERIFY)

    assert payload["sub"] == "42"
    assert payload["jti"] == jti
    assert payload["type"] == "verify"
    assert payload["role"] == "user"
    # 24h TTL comes from settings, not a hardcoded constant.
    assert payload["exp"] - payload["iat"] == get_settings().email_verify_ttl_seconds


def test_verification_token_not_accepted_as_access_token() -> None:
    token, _jti, _ = issue_verification_token(user_id=1, role="user")

    with pytest.raises(jwt.PyJWTError):
        decode_token(token, expected_type=ACCESS)


def test_verification_token_not_accepted_as_reset_token() -> None:
    token, _jti, _ = issue_verification_token(user_id=1, role="user")

    with pytest.raises(jwt.PyJWTError):
        decode_token(token, expected_type=RESET)


def test_access_token_not_accepted_as_verification_token() -> None:
    token, _jti, _ = issue_access_token(user_id=1, role="user")

    with pytest.raises(jwt.PyJWTError):
        decode_token(token, expected_type=VERIFY)


def test_password_fingerprint_is_stable_and_short() -> None:
    first = password_fingerprint("$argon2id$v=19$hash-a")
    second = password_fingerprint("$argon2id$v=19$hash-a")

    assert first == second
    assert len(first) == 16
    # Fingerprints of different hashes must not collide.
    assert first != password_fingerprint("$argon2id$v=19$hash-b")
    # Never the raw hash.
    assert "argon2" not in first


def test_reset_token_carries_fingerprint_of_current_hash() -> None:
    password_hash = "$argon2id$v=19$stored-hash"
    token, jti, _ = issue_password_reset_token(user_id=7, role="user", password_hash=password_hash)

    payload = decode_token(token, expected_type=RESET)

    assert payload["sub"] == "7"
    assert payload["jti"] == jti
    assert payload["type"] == "reset"
    assert payload["pwh"] == password_fingerprint(password_hash)
    assert payload["exp"] - payload["iat"] == get_settings().email_reset_ttl_seconds


def test_reset_token_fingerprint_changes_when_password_changes() -> None:
    before, _jti, _ = issue_password_reset_token(
        user_id=7, role="user", password_hash="$argon2id$old"
    )
    after, _jti2, _ = issue_password_reset_token(
        user_id=7, role="user", password_hash="$argon2id$new"
    )

    before_payload = decode_token(before, expected_type=RESET)
    after_payload = decode_token(after, expected_type=RESET)

    # This is what makes a reset token single-use with zero server state:
    # once the hash changes, the outstanding token's `pwh` stops matching.
    assert before_payload["pwh"] != after_payload["pwh"]
