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

TokenType = Literal["access", "refresh"]

# Final + explicit Literal -> mypy narrows these to the literal type.
ACCESS: Final[Literal["access"]] = "access"
REFRESH: Final[Literal["refresh"]] = "refresh"


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


async def blacklist_jti(jti: str, ttl_seconds: int) -> None:
    """Add a token's jti to the blacklist. TTL matches token lifetime."""
    if ttl_seconds <= 0:
        return
    client = get_redis()
    await client.set(RedisKeys.jwt_blacklist(jti), "1", ex=ttl_seconds)


async def is_blacklisted(jti: str) -> bool:
    client = get_redis()
    return bool(await client.exists(RedisKeys.jwt_blacklist(jti)))


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
