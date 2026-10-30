# tests/unit/test_secrets_provider.py
from __future__ import annotations

import builtins
import sys
from typing import Any

import pytest

from social_api.core.secrets import (
    AwsSecretsManagerProvider,
    EnvSecretsProvider,
    get_secrets_provider,
)

# ----------------------------- env backend -----------------------------


def test_get_provider_default_is_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECRETS_BACKEND", raising=False)
    provider = get_secrets_provider()
    assert isinstance(provider, EnvSecretsProvider)


def test_get_provider_aws_requires_secret_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.delenv("AWS_SECRET_ID", raising=False)
    with pytest.raises(RuntimeError, match="AWS_SECRET_ID"):
        get_secrets_provider()


# --------------------------- AWS backend paths ---------------------------
#
# We must be deterministic regardless of whether boto3 is installed in the
# dev venv. Two sub-cases:
#
#   1. boto3 NOT importable → get_secrets_provider() raises RuntimeError
#      mentioning boto3 (the "missing optional dep" behaviour).
#   2. boto3 importable → the provider constructs a real boto3 client, which
#      requires a region to be resolvable. We set AWS_DEFAULT_REGION so the
#      test never depends on the developer's AWS config.


def _hide_boto3(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the next `import boto3` to fail, as if boto3 were not installed."""
    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "boto3" or name.startswith("boto3."):
            raise ImportError("simulated: boto3 not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    # Also drop any cached boto3 modules so importlib re-invokes __import__.
    for mod in list(sys.modules):
        if mod == "boto3" or mod.startswith("boto3."):
            monkeypatch.delitem(sys.modules, mod, raising=False)


def test_get_provider_aws_missing_boto(monkeypatch: pytest.MonkeyPatch) -> None:
    """When boto3 is unimportable, provider raises RuntimeError mentioning boto3."""
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.setenv("AWS_SECRET_ID", "arn:aws:secretsmanager:us-east-1:123:secret:x")
    _hide_boto3(monkeypatch)

    with pytest.raises(RuntimeError, match="boto3"):
        get_secrets_provider()


def test_get_provider_aws_when_boto_present(monkeypatch: pytest.MonkeyPatch) -> None:
    """When boto3 IS importable, provider constructs successfully (region set)."""
    pytest.importorskip("boto3")
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.setenv("AWS_SECRET_ID", "arn:aws:secretsmanager:us-east-1:123:secret:x")
    # Deterministic region — never rely on the developer's ~/.aws/config.
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")

    provider = get_secrets_provider()
    assert isinstance(provider, AwsSecretsManagerProvider)
