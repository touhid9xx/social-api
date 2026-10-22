"""Password hashing (argon2id via passlib)."""

from __future__ import annotations

import re
from typing import cast

from passlib.context import CryptContext

_pwd = CryptContext(schemes=["argon2"], deprecated="auto", argon2__type="id")


# Min 12 chars, upper+lower+digit+symbol (per project spec).
_PASSWORD_RE = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$")


class WeakPasswordError(ValueError):
    """Raised when a password fails the policy."""


def validate_password_policy(raw: str) -> None:
    if len(raw) < 12:
        raise WeakPasswordError("Password must be at least 12 characters")
    if not _PASSWORD_RE.match(raw):
        raise WeakPasswordError("Password must contain upper, lower, digit, and symbol")


def hash_password(raw: str) -> str:
    validate_password_policy(raw)
    # passlib is untyped -> cast the Any result to str explicitly.
    return cast(str, _pwd.hash(raw))


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return cast(bool, _pwd.verify(raw, hashed))
    except (ValueError, TypeError):
        # Malformed hash — treat as mismatch, never crash
        return False
