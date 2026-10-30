"""Plain-text transactional email rendering (i18n en + bn)."""

from __future__ import annotations

import pytest

from social_api.config import get_settings
from social_api.email.templates import (
    render_notification_digest,
    render_password_reset,
    render_verification,
)

pytestmark = pytest.mark.unit

_BENGALI_START = 0x0980
_BENGALI_END = 0x09FF


def _base() -> str:
    return get_settings().web_app_url.rstrip("/")


def _has_bengali(text: str) -> bool:
    return any(_BENGALI_START <= ord(ch) <= _BENGALI_END for ch in text)


# ---- Verification ----


def test_verification_en_has_subject_link_and_expiry() -> None:
    hours = max(1, get_settings().email_verify_ttl_seconds // 3600)
    content = render_verification(token="tok-abc", locale="en")

    assert content.subject == "Verify your email address"
    assert f"{_base()}/verify-email?token=tok-abc" in content.body
    assert f"{hours} hours" in content.body
    # Plain text only — no HTML part, no markup to escape.
    assert "<html" not in content.body.lower()
    assert "<a " not in content.body.lower()


def test_verification_bn_is_translated_and_keeps_link() -> None:
    en = render_verification(token="tok-abc", locale="en")
    bn = render_verification(token="tok-abc", locale="bn")

    assert _has_bengali(bn.subject)
    assert bn.subject != en.subject
    # The deep link is locale-independent: same token, same URL.
    assert f"{_base()}/verify-email?token=tok-abc" in bn.body


def test_unknown_locale_falls_back_to_english() -> None:
    en = render_verification(token="tok-abc", locale="en")
    other = render_verification(token="tok-abc", locale="fr-FR,fr;q=0.9")

    assert other.subject == en.subject
    assert other.body == en.body


# ---- Password reset ----


def test_password_reset_en_has_subject_link_and_expiry() -> None:
    minutes = max(1, get_settings().email_reset_ttl_seconds // 60)
    content = render_password_reset(token="rst-xyz", locale="en")

    assert content.subject == "Reset your password"
    assert f"{_base()}/reset-password?token=rst-xyz" in content.body
    assert f"{minutes} minutes" in content.body


def test_password_reset_bn_is_translated_and_keeps_link() -> None:
    en = render_password_reset(token="rst-xyz", locale="en")
    bn = render_password_reset(token="rst-xyz", locale="bn")

    assert _has_bengali(bn.subject)
    assert bn.subject != en.subject
    assert f"{_base()}/reset-password?token=rst-xyz" in bn.body


def test_verification_and_reset_links_differ() -> None:
    verify = render_verification(token="same-token", locale="en")
    reset = render_password_reset(token="same-token", locale="en")

    assert "/verify-email?token=same-token" in verify.body
    assert "/reset-password?token=same-token" in reset.body


# ---- Notification digest ----


def test_notification_digest_renders_each_item() -> None:
    content = render_notification_digest(
        username="alice",
        items=["Bob liked your post", "Carol started following you"],
        locale="en",
    )

    assert content.subject == "Your notification digest"
    assert "alice" in content.body
    assert "- Bob liked your post" in content.body
    assert "- Carol started following you" in content.body


def test_notification_digest_bn_is_translated() -> None:
    en = render_notification_digest(username="alice", items=["Bob liked your post"], locale="en")
    bn = render_notification_digest(username="alice", items=["Bob liked your post"], locale="bn")

    assert _has_bengali(bn.subject)
    assert bn.subject != en.subject
    assert "alice" in bn.body
    assert "- Bob liked your post" in bn.body


def test_notification_digest_with_no_items_still_renders() -> None:
    content = render_notification_digest(username="bob", items=[], locale="en")

    assert "bob" in content.body
    assert content.subject
