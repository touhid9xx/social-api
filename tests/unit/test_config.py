"""Settings: defaults, validation, derived properties."""

# pyright: reportCallIssue=false
from __future__ import annotations

import pytest
from pydantic import ValidationError

from social_api.config import Settings, get_settings

pytestmark = pytest.mark.unit


def test_defaults_load() -> None:
    s = Settings(_env_file=None)
    assert s.api_v1_prefix == "/api/v1"
    assert s.jwt_access_ttl_seconds == 900
    assert s.jwt_refresh_ttl_seconds == 604_800


def test_unsupported_log_level_raises() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, log_level="TRACE")


def test_log_level_normalized_to_upper() -> None:
    s = Settings(_env_file=None, log_level="info")
    assert s.log_level == "INFO"


def test_supported_locales_list() -> None:
    s = Settings(_env_file=None, supported_locales="en, bn ,fr")
    assert s.supported_locales_list == ["en", "bn", "fr"]


def test_cors_origins_list() -> None:
    s = Settings(_env_file=None, cors_origins="http://a, http://b")
    assert s.cors_origins_list == ["http://a", "http://b"]


def test_default_cors_origins_cover_both_loopback_spellings() -> None:
    """`localhost` and `127.0.0.1` are distinct browser origins.

    Allowing only one of them makes a dev frontend that is opened as the other
    fail its preflight, which surfaces in the client as a network error rather
    than as anything naming CORS.
    """
    origins = Settings(_env_file=None).cors_origins_list
    assert "http://localhost:3000" in origins
    assert "http://127.0.0.1:3000" in origins


def test_is_production() -> None:
    assert Settings(_env_file=None, app_env="production").is_production
    assert not Settings(_env_file=None, app_env="development").is_production


def test_get_settings_is_cached() -> None:
    get_settings.cache_clear()
    a = get_settings()
    b = get_settings()
    assert a is b
    get_settings.cache_clear()
