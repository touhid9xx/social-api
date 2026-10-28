"""SecretsProvider abstraction.

Production deployments often pull secrets from a managed store
(AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) rather than
env vars on disk. This module defines the interface and ships with an
env-default provider + a minimal AWS stub.

Usage in deployment:

    1. Entrypoint (or CD script) calls `bootstrap_env_from_provider()`
       — pulls every SECRET_* key from the configured provider into
       os.environ.
    2. Uvicorn starts, `Settings` reads env as usual.

Why not wire Settings through SecretsProvider directly?
    Settings is sync and used at import time by ~20 modules. Making it
    async to fetch from AWS would cascade. Bootstrap approach keeps
    Settings simple, gets secrets where they belong (env at runtime,
    not baked into the image), and remains portable.
"""

from __future__ import annotations

import os
from typing import Protocol

from social_api.logging_config import get_logger

logger = get_logger(__name__)


class SecretsProvider(Protocol):
    def get(self, name: str, *, default: str | None = None) -> str | None: ...


class EnvSecretsProvider:
    """Read from environment. Default in dev / most deployments."""

    def get(self, name: str, *, default: str | None = None) -> str | None:
        return os.environ.get(name, default)


class AwsSecretsManagerProvider:
    """
    Reads a JSON blob from AWS Secrets Manager and serves keys from it.

    Requires: boto3 (in `s3` extra), IAM permission
    secretsmanager:GetSecretValue on the configured secret ARN.

    Not exercised in CI (no AWS creds). Interface-ready.
    """

    def __init__(
        self,
        *,
        secret_id: str,
        region_name: str | None = None,
    ) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                'AwsSecretsManagerProvider requires boto3. Install with: pip install -e ".[s3]"'
            ) from exc

        self._client = boto3.client("secretsmanager", region_name=region_name)
        self._secret_id = secret_id
        self._cache: dict[str, str] | None = None

    def _load(self) -> dict[str, str]:
        if self._cache is not None:
            return self._cache
        import json

        resp = self._client.get_secret_value(SecretId=self._secret_id)
        raw = resp.get("SecretString") or "{}"
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise RuntimeError(f"AWS secret {self._secret_id} must be a JSON object")
        self._cache = {str(k): str(v) for k, v in data.items()}
        return self._cache

    def get(self, name: str, *, default: str | None = None) -> str | None:
        try:
            return self._load().get(name, default)
        except Exception as exc:  # pragma: no cover — network
            logger.warning(
                "aws_secret_fetch_failed",
                name=name,
                error=type(exc).__name__,
            )
            return default


def get_secrets_provider() -> SecretsProvider:
    """Factory: env by default; AWS if SECRETS_BACKEND=aws."""
    backend = os.environ.get("SECRETS_BACKEND", "env").lower()
    if backend == "aws":
        secret_id = os.environ.get("AWS_SECRET_ID", "")
        region = os.environ.get("AWS_REGION")
        if not secret_id:
            raise RuntimeError("SECRETS_BACKEND=aws requires AWS_SECRET_ID env var")
        return AwsSecretsManagerProvider(secret_id=secret_id, region_name=region)
    return EnvSecretsProvider()


def bootstrap_env_from_provider(
    *,
    names: list[str] | None = None,
) -> int:
    """
    Pull secrets from configured provider into os.environ.

    Called by entrypoint before uvicorn starts. Idempotent — existing env
    vars are NOT overwritten (they win, so dev workflows unaffected).

    Returns count of names populated (0 = nothing changed).
    """
    if names is None:
        # Default set: everything Settings reads as secret.
        names = [
            "ENCRYPTION_KEY",
            "JWT_PRIVATE_KEY",
            "JWT_PUBLIC_KEY",
            "MYSQL_PASSWORD",
            "MYSQL_ROOT_PASSWORD",
            "SMTP_PASSWORD",
        ]

    provider = get_secrets_provider()
    populated = 0
    for name in names:
        if os.environ.get(name):
            continue
        value = provider.get(name)
        if value is not None:
            os.environ[name] = value
            populated += 1
    if populated:
        logger.info("secrets_bootstrapped", count=populated)
    return populated
