"""SecretsProvider abstraction."""

from __future__ import annotations

import os

import pytest

from social_api.core.secrets import (
    AwsSecretsManagerProvider,
    EnvSecretsProvider,
    bootstrap_env_from_provider,
    get_secrets_provider,
)

pytestmark = pytest.mark.unit


def test_env_provider_reads_os_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_SECRET_ABC", "value-here")
    p = EnvSecretsProvider()
    assert p.get("TEST_SECRET_ABC") == "value-here"


def test_env_provider_default() -> None:
    p = EnvSecretsProvider()
    assert p.get("DOES_NOT_EXIST_XYZ") is None
    assert p.get("DOES_NOT_EXIST_XYZ", default="d") == "d"


def test_get_provider_default_env() -> None:
    # Default backend is env when SECRETS_BACKEND unset.
    p = get_secrets_provider()
    assert isinstance(p, EnvSecretsProvider)


def test_get_provider_aws_requires_secret_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.delenv("AWS_SECRET_ID", raising=False)
    with pytest.raises(RuntimeError, match="AWS_SECRET_ID"):
        get_secrets_provider()


def test_get_provider_aws_missing_boto(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With SECRETS_BACKEND=aws but boto3 not importable, the provider
    raises RuntimeError mentioning boto3.

    boto3 is intentionally NOT a dev dependency (it's an optional extra
    — `pip install -e ".[aws]"`). If your dev environment has boto3 for
    some reason, this test will fail as a false positive; switch to the
    skip/importorskip pattern in test_get_provider_aws_when_boto_present
    (below) if you want coverage in both environments.
    """
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.setenv(
        "AWS_SECRET_ID",
        "arn:aws:secretsmanager:us-east-1:123:secret:x",
    )
    with pytest.raises(RuntimeError, match="boto3"):
        get_secrets_provider()


def test_get_provider_aws_when_boto_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If boto3 IS installed, get_secrets_provider() returns the AWS class.

    Skip when boto3 is absent — the missing-boto path is covered by
    test_get_provider_aws_missing_boto.
    """
    pytest.importorskip("boto3")
    monkeypatch.setenv("SECRETS_BACKEND", "aws")
    monkeypatch.setenv(
        "AWS_SECRET_ID",
        "arn:aws:secretsmanager:us-east-1:123:secret:x",
    )
    p = get_secrets_provider()
    assert isinstance(p, AwsSecretsManagerProvider)


def test_bootstrap_populates_missing_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Ensure target vars absent.
    for k in ("ENCRYPTION_KEY", "MYSQL_PASSWORD"):
        monkeypatch.delenv(k, raising=False)

    # Env provider returns nothing (env is empty) → count 0.
    populated = bootstrap_env_from_provider(names=["ENCRYPTION_KEY", "MYSQL_PASSWORD"])
    assert populated == 0


def test_bootstrap_does_not_overwrite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENCRYPTION_KEY", "existing")
    # Provider (env) would return "existing" — but bootstrap should NOT
    # overwrite (existing env wins). Verify no exception, count 0.
    n = bootstrap_env_from_provider(names=["ENCRYPTION_KEY"])
    assert n == 0
    assert os.environ["ENCRYPTION_KEY"] == "existing"
