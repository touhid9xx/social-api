"""Plain-text transactional templates: verification, reset, digest.

Templates are rendered through the *existing* i18n catalog
(`i18n/messages/{en,bn}.json`) rather than a second, parallel
translation system: one catalog, one translator, one set of fallback
rules and one set of tests. Email keys live in the flat `email.*`
namespace (the catalog loader only flattens one nesting level, so keys
are always written flat).

Everything here is plain text on purpose — no HTML part, no template
engine, no user-supplied markup to escape.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from social_api.config import get_settings
from social_api.i18n import t


@dataclass(frozen=True, slots=True)
class EmailContent:
    """A rendered, ready-to-send message body."""

    subject: str
    body: str


def _link(path: str, token: str) -> str:
    """Absolute deep link into the web client, carrying the one-time token."""
    base = get_settings().web_app_url.rstrip("/")
    return f"{base}{path}?token={token}"


def _join(*parts: str) -> str:
    return "\n\n".join(p for p in parts if p)


def render_verification(*, token: str, locale: str | None = None) -> EmailContent:
    """24h email-verification message (purpose='verify' JWT)."""
    settings = get_settings()
    hours = max(1, settings.email_verify_ttl_seconds // 3600)
    body = _join(
        t("email.verify.greeting", locale=locale),
        t("email.verify.body", locale=locale),
        t("email.verify.cta", locale=locale, link=_link("/verify-email", token)),
        t("email.verify.expiry", locale=locale, hours=hours),
        t("email.verify.ignore", locale=locale),
    )
    return EmailContent(
        subject=t("email.verify.subject", locale=locale),
        body=body,
    )


def render_password_reset(*, token: str, locale: str | None = None) -> EmailContent:
    """1h password-reset message (purpose='reset' JWT)."""
    settings = get_settings()
    minutes = max(1, settings.email_reset_ttl_seconds // 60)
    body = _join(
        t("email.reset.greeting", locale=locale),
        t("email.reset.body", locale=locale),
        t("email.reset.cta", locale=locale, link=_link("/reset-password", token)),
        t("email.reset.expiry", locale=locale, minutes=minutes),
        t("email.reset.ignore", locale=locale),
    )
    return EmailContent(
        subject=t("email.reset.subject", locale=locale),
        body=body,
    )


def render_notification_digest(
    *,
    username: str,
    items: Sequence[str],
    locale: str | None = None,
) -> EmailContent:
    """Batched notification digest. `items` are already-translated one-liners."""
    body = _join(
        t("email.digest.heading", locale=locale, username=username),
        "\n".join(t("email.digest.item", locale=locale, item=item) for item in items),
        t("email.digest.footer", locale=locale),
    )
    return EmailContent(
        subject=t("email.digest.subject", locale=locale),
        body=body,
    )
