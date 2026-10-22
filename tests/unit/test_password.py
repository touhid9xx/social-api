"""Password hashing + policy."""

from __future__ import annotations

import pytest

from social_api.core.password import (
    WeakPasswordError,
    hash_password,
    validate_password_policy,
    verify_password,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "pwd",
    [
        "Short1!",  # <12
        "alllowercase123!",  # no upper
        "ALLUPPERCASE123!",  # no lower
        "NoDigitsHere!!!",  # no digit
        "NoSymbolsHere123",  # no symbol
    ],
)
def test_weak_passwords_rejected(pwd: str) -> None:
    with pytest.raises(WeakPasswordError):
        validate_password_policy(pwd)


def test_strong_password_accepted() -> None:
    validate_password_policy("Str0ng!Passw0rd")


def test_hash_and_verify() -> None:
    h = hash_password("Str0ng!Passw0rd")
    assert h != "Str0ng!Passw0rd"
    assert h.startswith("$argon2id$")
    assert verify_password("Str0ng!Passw0rd", h)
    assert not verify_password("WrongPass!1234", h)


def test_verify_malformed_hash_returns_false() -> None:
    assert verify_password("anything", "not-a-valid-hash") is False


def test_hash_rejects_weak_password() -> None:
    with pytest.raises(WeakPasswordError):
        hash_password("short")
