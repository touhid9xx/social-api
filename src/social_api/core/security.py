"""JWT (RS256) issue/verify + refresh rotation + JTI blacklist."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Literal

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import (
    RSAPrivateKey,
    RSAPublicKey,
)

from social_api.cache.keys import RedisKeys
from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

TokenType = Literal["access", "refresh", "verify", "reset"]

# Final + explicit Literal -> mypy narrows these to the literal type.
ACCESS: Final[Literal["access"]] = "access"
REFRESH: Final[Literal["refresh"]] = "refresh"
# One-time, self-contained email tokens. They share the RS256 key with
# access/refresh tokens but their `type` claim differs, so decode_token()
# can never accept one in place of an access token (and vice versa).
VERIFY: Final[Literal["verify"]] = "verify"
RESET: Final[Literal["reset"]] = "reset"

OneTimeTokenType = Literal["verify", "reset"]


@lru_cache(maxsize=1)
def _load_private_key() -> RSAPrivateKey:
    settings = get_settings()
    path = Path(settings.jwt_private_key_path)
    if not path.exists():
        raise RuntimeError(f"JWT private key not found at {path}")
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, RSAPrivateKey):
        raise RuntimeError("JWT private key is not RSA")
    return key


@lru_cache(maxsize=1)
def _load_public_key() -> RSAPublicKey:
    settings = get_settings()
    path = Path(settings.jwt_public_key_path)
    if not path.exists():
        raise RuntimeError(f"JWT public key not found at {path}")
    key = serialization.load_pem_public_key(path.read_bytes())
    if not isinstance(key, RSAPublicKey):
        raise RuntimeError("JWT public key is not RSA")
    return key


def _now() -> datetime:
    return datetime.now(UTC)


def _encode(
    *,
    sub: str,
    token_type: TokenType,
    role: str,
    ttl_seconds: int,
    extra: dict[str, Any] | None = None,
) -> tuple[str, str, datetime]:
    """Returns (token, jti, expires_at)."""
    settings = get_settings()
    jti = str(uuid.uuid4())
    issued = _now()
    expires = issued + timedelta(seconds=ttl_seconds)
    payload: dict[str, Any] = {
        "sub": sub,
        "role": role,
        "type": token_type,
        "jti": jti,
        "iat": int(issued.timestamp()),
        "exp": int(expires.timestamp()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    if extra:
        # Caller-supplied claims (e.g. `pwh` on reset tokens). Reserved
        # claims can never be overwritten — a caller must not be able to
        # mint a token with a forged `type`/`sub`/`exp`.
        payload.update({k: v for k, v in extra.items() if k not in payload})
    token = jwt.encode(payload, _load_private_key(), algorithm=settings.jwt_algorithm)
    return token, jti, expires


def _decode_unverified(token: str) -> dict[str, Any]:
    """
    Decode without signature verification — ONLY to read `exp` for blacklist TTL.
    Never trust the returned dict for authz.
    """
    return jwt.decode(token, options={"verify_signature": False, "verify_aud": False})


def decode_token(token: str, *, expected_type: TokenType) -> dict[str, Any]:
    """
    Verify signature + claims. Raises jwt.PyJWTError on any issue.
    """
    settings = get_settings()
    payload: dict[str, Any] = jwt.decode(
        token,
        _load_public_key(),
        algorithms=[settings.jwt_algorithm],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(f"expected {expected_type} token")
    if "jti" not in payload or "sub" not in payload:
        raise jwt.InvalidTokenError("missing jti or sub")
    return payload


def issue_access_token(*, user_id: int, role: str) -> tuple[str, str, datetime]:
    settings = get_settings()
    return _encode(
        sub=str(user_id),
        token_type=ACCESS,
        role=role,
        ttl_seconds=settings.jwt_access_ttl_seconds,
    )


def issue_refresh_token(*, user_id: int, role: str) -> tuple[str, str, datetime]:
    settings = get_settings()
    return _encode(
        sub=str(user_id),
        token_type=REFRESH,
        role=role,
        ttl_seconds=settings.jwt_refresh_ttl_seconds,
    )


def password_fingerprint(password_hash: str) -> str:
    """
    Short, non-reversible digest of the stored password hash.

    Embedded in a reset token as the `pwh` claim. This makes reset tokens
    single-use *without* any server-side state: consuming a token rewrites
    `users.password_hash`, so every other outstanding reset token for that
    user stops matching. No DB table, no Redis round trip on the hot path.
    """
    return hashlib.sha256(password_hash.encode("utf-8")).hexdigest()[:16]


def issue_verification_token(*, user_id: int, role: str) -> tuple[str, str, datetime]:
    """Signed, self-contained email-verification token (purpose='verify')."""
    settings = get_settings()
    return _encode(
        sub=str(user_id),
        token_type=VERIFY,
        role=role,
        ttl_seconds=settings.email_verify_ttl_seconds,
    )


def issue_password_reset_token(
    *, user_id: int, role: str, password_hash: str
) -> tuple[str, str, datetime]:
    """Signed, self-contained password-reset token (purpose='reset').

    Carries `pwh`, a fingerprint of the *current* password hash, so the
    token dies as soon as the password actually changes (single-use).
    """
    settings = get_settings()
    return _encode(
        sub=str(user_id),
        token_type=RESET,
        role=role,
        ttl_seconds=settings.email_reset_ttl_seconds,
        extra={"pwh": password_fingerprint(password_hash)},
    )


async def blacklist_jti(jti: str, ttl_seconds: int) -> None:
    """Add a token's jti to the blacklist. TTL matches token lifetime."""
    if ttl_seconds <= 0:
        return
    client = get_redis()
    await client.set(RedisKeys.jwt_blacklist(jti), "1", ex=ttl_seconds)


async def is_blacklisted(jti: str) -> bool:
    from social_api.cache.keys import RedisKeys
    from social_api.cache.redis import get_redis, guarded

    client = get_redis()

    async def _check() -> bool:
        return bool(await client.exists(RedisKeys.jwt_blacklist(jti)))

    return await guarded(_check, default=False, op="jwt_blacklist_check")


async def revoke_token(token: str, *, expected_type: TokenType) -> None:
    """Verify (or best-effort decode) and add JTI to blacklist with correct TTL."""
    try:
        payload = decode_token(token, expected_type=expected_type)
        exp = int(payload["exp"])
    except jwt.PyJWTError:
        # Even invalid tokens we try to blacklist by decoding exp unverified,
        # but only if it has a jti. Fail silent — logout is idempotent.
        try:
            payload = _decode_unverified(token)
            exp = int(payload.get("exp", 0))
            jti = payload.get("jti")
            if not jti:
                return
        except jwt.PyJWTError:
            return
    else:
        jti = payload["jti"]

    now_ts = int(_now().timestamp())
    ttl = max(0, exp - now_ts)
    if ttl > 0:
        await blacklist_jti(jti, ttl)


# ---- helpers for tests ----
def hash_email(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
