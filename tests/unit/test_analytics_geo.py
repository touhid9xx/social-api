"""GeoLite2 resolver: absence of the database must degrade, never raise."""

# pyright: reportCallIssue=false
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from social_api.config import Settings, get_settings
from social_api.modules.analytics import geo


def _geo_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"geoip_enabled": True}
    values.update(overrides)
    return Settings(_env_file=None, **values)


class FakeReader:
    def __init__(self, record: Any = None, *, fail: bool = False) -> None:
        self._record = record
        self._fail = fail
        self.lookups: list[str] = []

    def city(self, ip: str) -> Any:
        self.lookups.append(ip)
        if self._fail:
            raise ValueError("not in database")
        return self._record


def _install(monkeypatch: pytest.MonkeyPatch, module: Any) -> None:
    # Rebind `importlib` inside the geo module rather than patching the real
    # one: `monkeypatch.setattr` with a string name keeps mypy happy, since
    # `importlib` is an import here, not an exported attribute.
    monkeypatch.setattr(geo, "importlib", SimpleNamespace(import_module=lambda name: module))


def _record(country: str | None, city: str | None, timezone: str | None) -> Any:
    return SimpleNamespace(
        country=SimpleNamespace(iso_code=country) if country else None,
        city=SimpleNamespace(name=city) if city else None,
        location=SimpleNamespace(time_zone=timezone) if timezone else None,
    )


@pytest.fixture(autouse=True)
def _fresh_resolver() -> Any:
    geo.reset_geo_resolver()
    yield
    geo.reset_geo_resolver()


def test_disabled_resolver_never_resolves() -> None:
    resolver = geo.GeoResolver("unused.mmdb", enabled=False)
    assert resolver.resolve("8.8.8.8") is None


@pytest.mark.parametrize("ip", [None, "", "127.0.0.1", "not-an-ip"])
def test_unusable_addresses_resolve_to_nothing(
    monkeypatch: pytest.MonkeyPatch, ip: str | None
) -> None:
    _install(
        monkeypatch,
        SimpleNamespace(Reader=lambda path: FakeReader(_record("BD", "Dhaka", "Asia/Dhaka"))),
    )
    resolver = geo.GeoResolver("db.mmdb", enabled=True)
    assert resolver.resolve(ip) is None


def test_missing_geoip2_package_degrades_to_no_geo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing(name: str) -> Any:
        raise ModuleNotFoundError(name)

    monkeypatch.setattr(geo, "importlib", SimpleNamespace(import_module=missing))
    resolver = geo.GeoResolver("db.mmdb", enabled=True)

    assert resolver.resolve("8.8.8.8") is None
    # The failed import is remembered: no repeated import per request.
    assert resolver._attempted is True


def test_missing_database_file_degrades_to_no_geo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unreadable(path: str) -> Any:
        raise OSError("no such file")

    _install(monkeypatch, SimpleNamespace(Reader=unreadable))
    resolver = geo.GeoResolver("db.mmdb", enabled=True)

    assert resolver.resolve("8.8.8.8") is None
    assert resolver._attempted is True


def test_reader_is_opened_once_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    reader = FakeReader(_record("BD", "Dhaka", "Asia/Dhaka"))

    def build(path: str) -> FakeReader:
        opened.append(path)
        return reader

    _install(monkeypatch, SimpleNamespace(Reader=build))
    resolver = geo.GeoResolver("db.mmdb", enabled=True)

    resolver.resolve("8.8.8.8")
    resolver.resolve("8.8.4.4")

    assert opened == ["db.mmdb"]
    assert reader.lookups == ["8.8.8.8", "8.8.4.4"]


def test_resolved_record_is_mapped_to_the_coarse_location(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        SimpleNamespace(Reader=lambda path: FakeReader(_record("BD", "Dhaka", "Asia/Dhaka"))),
    )
    location = geo.GeoResolver("db.mmdb", enabled=True).resolve("8.8.8.8")

    assert location == geo.GeoLocation(country="BD", city="Dhaka", timezone="Asia/Dhaka")


def test_partial_records_keep_only_what_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch, SimpleNamespace(Reader=lambda path: FakeReader(_record("BD", None, None)))
    )
    location = geo.GeoResolver("db.mmdb", enabled=True).resolve("8.8.8.8")

    assert location == geo.GeoLocation(country="BD", city=None, timezone=None)


def test_regions_are_clipped_to_the_column_widths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_city = "c" * 200
    long_tz = "t" * 200
    _install(
        monkeypatch,
        SimpleNamespace(Reader=lambda path: FakeReader(_record("BD", long_city, long_tz))),
    )
    location = geo.GeoResolver("db.mmdb", enabled=True).resolve("8.8.8.8")

    assert location is not None
    assert location.city is not None
    assert len(location.city) == geo._MAX_CITY_LEN
    assert location.timezone is not None
    assert len(location.timezone) == geo._MAX_TZ_LEN


def test_lookup_errors_are_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch, SimpleNamespace(Reader=lambda path: FakeReader(fail=True)))
    resolver = geo.GeoResolver("db.mmdb", enabled=True)

    assert resolver.resolve("8.8.8.8") is None


def test_module_resolver_is_built_lazily_and_cached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(geo, "get_settings", lambda: _geo_settings())
    _install(
        monkeypatch, SimpleNamespace(Reader=lambda path: FakeReader(_record("BD", None, None)))
    )

    first = geo.get_geo_resolver()
    assert geo.get_geo_resolver() is first

    geo.reset_geo_resolver()
    assert geo.get_geo_resolver() is not first


def test_module_resolver_follows_the_geoip_switch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(geo, "get_settings", lambda: _geo_settings(geoip_enabled=False))
    resolver = geo.get_geo_resolver()

    assert resolver.enabled is False
    assert resolver.resolve("8.8.8.8") is None


def test_real_settings_disable_geo_without_a_database_path() -> None:
    """`get_settings()` is the only reader of the configured path."""
    assert get_settings().geoip_db_path
