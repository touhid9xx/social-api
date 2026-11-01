"""Offline MaxMind GeoLite2 City lookups.

`geoip2` is an *optional* dependency. Everything here degrades to `None`
instead of raising: a missing package, a missing/unreadable `.mmdb`, and
private/loopback/link-local addresses all simply yield no location. Geo is
an enrichment, never a prerequisite for recording a visit.
"""

from __future__ import annotations

import importlib
import ipaddress
import threading
from dataclasses import dataclass
from typing import Any

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

_MAX_CITY_LEN = 64
_MAX_TZ_LEN = 64


@dataclass(frozen=True, slots=True)
class GeoLocation:
    """Coarse location for one request. Never finer than city level."""

    country: str | None = None
    city: str | None = None
    timezone: str | None = None


def _clip(value: Any, limit: int) -> str | None:
    """Coerce a GeoLite2 field to a length-capped string (or None)."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:limit]


class GeoResolver:
    """Lazily-opened GeoLite2 reader with a fail-soft lookup.

    The reader is opened on first use rather than at import so a bad
    `geoip_db_path` cannot stop the app from booting. `threading.Lock`
    guards the one-time open; `Reader.city()` itself is thread-safe.
    """

    def __init__(self, db_path: str, *, enabled: bool) -> None:
        self._db_path = db_path
        self._enabled = enabled
        self._lock = threading.Lock()
        self._reader: Any = None
        self._attempted = False

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _get_reader(self) -> Any:
        # Test through a local: testing `self._attempted` directly narrows it
        # to Literal[False], which makes the race re-check below look dead.
        attempted = self._attempted
        if attempted:
            return self._reader
        with self._lock:
            if self._attempted:
                return self._reader
            self._attempted = True
            if not self._enabled:
                return None
            try:
                module = importlib.import_module("geoip2.database")
            except ModuleNotFoundError:
                logger.info(
                    "geoip_unavailable",
                    reason="geoip2_not_installed",
                    hint="pip install 'geoip2' and set GEOIP_DB_PATH",
                )
                return None
            try:
                self._reader = module.Reader(self._db_path)
                logger.info("geoip_reader_loaded", path=self._db_path)
            except Exception as exc:
                logger.warning(
                    "geoip_reader_unavailable",
                    path=self._db_path,
                    error=type(exc).__name__,
                )
                self._reader = None
            return self._reader

    def resolve(self, ip: str | None) -> GeoLocation | None:
        """Resolve a client IP to a coarse location, or None."""
        if not ip or not self._enabled:
            return None
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return None
        # Private / loopback / link-local peers are proxies or health checks,
        # never real visitors — and must not pollute the region table.
        if not addr.is_global:
            return None

        reader = self._get_reader()
        if reader is None:
            return None
        try:
            record = reader.city(str(addr))
        except Exception as exc:
            logger.debug("geoip_lookup_failed", error=type(exc).__name__)
            return None

        country = _clip(getattr(record.country, "iso_code", None), 2)
        city = _clip(getattr(record.city, "name", None), _MAX_CITY_LEN)
        timezone = _clip(getattr(record.location, "time_zone", None), _MAX_TZ_LEN)
        if country is None and city is None and timezone is None:
            return None
        return GeoLocation(country=country, city=city, timezone=timezone)


_resolver: GeoResolver | None = None


def get_geo_resolver() -> GeoResolver:
    """Process-wide resolver (one open `.mmdb` handle per worker)."""
    global _resolver
    if _resolver is None:
        settings = get_settings()
        _resolver = GeoResolver(settings.geoip_db_path, enabled=settings.geoip_enabled)
    return _resolver


def reset_geo_resolver() -> None:
    """Drop the cached resolver — tests only."""
    global _resolver
    _resolver = None
