"""Locale-aware message translation with fallback to English."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)

MESSAGES_DIR = Path(__file__).parent / "messages"


@lru_cache(maxsize=8)
def _load_catalog(locale: str) -> dict[str, str]:
    """Load a locale JSON file. Missing -> empty dict."""
    path = MESSAGES_DIR / f"{locale}.json"
    if not path.exists():
        logger.warning("i18n_catalog_missing", locale=locale, path=str(path))
        return {}
    with path.open("r", encoding="utf-8") as f:
        data: dict[str, Any] = json.load(f)
    # flatten one level (support nested in future)
    flat: dict[str, str] = {}
    for k, v in data.items():
        if isinstance(v, str):
            flat[k] = v
        elif isinstance(v, dict):
            for kk, vv in v.items():
                flat[f"{k}.{kk}"] = str(vv)
    return flat


def _pick_locale(requested: str | None) -> str:
    """Match requested locale to supported. Fallback to default."""
    settings = get_settings()
    supported = settings.supported_locales_list
    if not requested:
        return settings.default_locale
    # Accept 'en-US,en;q=0.9' style headers
    primary = requested.split(",")[0].split("-")[0].strip().lower()
    return primary if primary in supported else settings.default_locale


def t(key: str, *, locale: str | None = None, **kwargs: Any) -> str:
    """
    Translate a message key.

    - Falls back to default locale, then to key itself.
    - Supports Python .format() interpolation via kwargs.
    """
    chosen = _pick_locale(locale)
    catalog = _load_catalog(chosen)
    template = catalog.get(key)

    if template is None:
        default_catalog = _load_catalog(get_settings().default_locale)
        template = default_catalog.get(key)

    if template is None:
        logger.warning("i18n_key_missing", key=key, locale=chosen)
        return key

    try:
        return template.format(**kwargs) if kwargs else template
    except (KeyError, IndexError):
        logger.warning("i18n_format_error", key=key, locale=chosen, kwargs=list(kwargs))
        return template
