"""SQLAlchemy custom types — encrypted-at-rest PII fields."""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import String, TypeDecorator
from sqlalchemy.engine import Dialect

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """Build Fernet from settings. One per process."""
    settings = get_settings()
    key = settings.encryption_key
    if not key:
        # Fail loud — never silently use a dev key in prod-looking code.
        raise RuntimeError(
            "ENCRYPTION_KEY is not set. Generate with: "
            'python -c "from cryptography.fernet import Fernet; '
            'print(Fernet.generate_key().decode())"'
        )
    return Fernet(key.encode("utf-8"))


class EncryptedString(TypeDecorator[str]):
    """
    Transparent Fernet encryption for a text column.

    - Python side always sees plaintext (str).
    - DB stores base64 ciphertext.
    - Uses deterministic auth: no PII leaks in logs (structlog redacts on top).

    Length note: ciphertext is longer than plaintext; allocate DB column
    generously (e.g. VARCHAR(1024) for emails).
    """

    impl = String(1024)
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return _get_fernet().encrypt(value.encode("utf-8")).decode("ascii")

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        try:
            return _get_fernet().decrypt(value.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            # Never crash the ORM on corrupt data — surface as opaque marker.
            logger.error("encrypted_string_decrypt_failed")
            return None


class EncryptedText(EncryptedString):
    """Same as EncryptedString but semantically for longer content."""

    impl = String(4096)
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        return super().process_bind_param(value, dialect)

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        return super().process_result_value(value, dialect)
