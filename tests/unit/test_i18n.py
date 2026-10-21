"""i18n: locale pick, fallback, interpolation, missing keys."""

from __future__ import annotations

import pytest

from social_api.i18n.translator import _load_catalog, _pick_locale, t

pytestmark = pytest.mark.unit


def test_translate_en() -> None:
    assert t("health.ok", locale="en") == "Service is healthy"


def test_translate_bn() -> None:
    assert t("health.ok", locale="bn") == "সার্ভিস সচল আছে"


def test_fallback_to_default_when_locale_unknown() -> None:
    # 'fr' not in supported -> default 'en'
    assert t("health.ok", locale="fr") == "Service is healthy"


def test_fallback_to_key_when_missing() -> None:
    assert t("does.not.exist", locale="en") == "does.not.exist"


def test_interpolation() -> None:
    out = t("notification.new_follower", locale="en", username="Alice")
    assert out == "Alice started following you"


def test_interpolation_bn() -> None:
    out = t("notification.new_follower", locale="bn", username="Rahim")
    assert "Rahim" in out


def test_pick_locale_variants() -> None:
    assert _pick_locale(None) == "en"
    assert _pick_locale("en-US,en;q=0.9") == "en"
    assert _pick_locale("bn-BD") == "bn"
    assert _pick_locale("fr-FR") == "en"  # unsupported -> default


def test_load_catalog_flat_and_nested() -> None:
    cat = _load_catalog("en")
    assert "health.ok" in cat
    assert isinstance(cat["health.ok"], str)


def test_format_error_falls_back_to_template() -> None:
    # 'health.ok' has no placeholders; passing kwargs must not raise
    out = t("health.ok", locale="en", unused="x")
    assert out == "Service is healthy"
