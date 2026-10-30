"""Optional SMS channel (textbee.dev). Off by default: FF_SMS_ENABLED=false.

Deliberately mirrors `email/sender.py` — same flag gate, same circuit
breaker pattern, same `send_*` / `dispatch_*` split — so moving a
notification from one channel to the other is a one-line change.

The phone number is never logged in clear text (PII): only the last two
digits are emitted, enough to correlate a failure with a user report.
"""

from __future__ import annotations

import httpx

from social_api.config import get_settings
from social_api.core.circuit_breakers import BreakerOpenError, sms_breaker
from social_api.core.feature_flags import get_flags
from social_api.logging_config import get_logger

logger = get_logger(__name__)

# Hard cap on one SMS body — longest single-segment payload is 160 chars.
MAX_SMS_CHARS = 160


def _count(result: str) -> None:
    try:
        from social_api.observability.metrics import outbound_message_total

        outbound_message_total.labels(channel="sms", result=result).inc()
    except Exception as exc:  # pragma: no cover — metrics optional
        logger.debug("sms_metric_failed", error=type(exc).__name__)


def _masked(phone: str) -> str:
    """`+8801******67` — enough to trace, not enough to contact."""
    tail = phone[-2:] if len(phone) >= 2 else ""
    return f"***{tail}"


def _endpoint() -> str:
    settings = get_settings()
    base = settings.textbee_base_url.rstrip("/")
    return f"{base}/gateway/devices/{settings.textbee_device_id}/send-sms"


async def send_sms(*, to: str, body: str) -> bool:
    """Send one SMS.

    Returns True when the gateway accepted it, False when skipped (flag
    off / not configured / breaker open). Re-raises gateway errors so a
    caller can decide whether to retry.
    """
    if not get_flags().is_enabled("sms_enabled"):
        logger.info("sms_skipped_flag_disabled", to=_masked(to))
        _count("skipped")
        return False

    settings = get_settings()
    if not settings.textbee_api_key or not settings.textbee_device_id:
        # Flag on but no credentials: configuration error, not an outage.
        logger.warning("sms_skipped_not_configured", to=_masked(to))
        _count("skipped")
        return False

    payload = {"recipients": [to], "message": body[:MAX_SMS_CHARS]}
    headers = {"x-api-key": settings.textbee_api_key}

    async def _deliver() -> None:
        async with httpx.AsyncClient(timeout=settings.sms_timeout_seconds) as client:
            response = await client.post(_endpoint(), json=payload, headers=headers)
            response.raise_for_status()

    try:
        await sms_breaker.call(_deliver)
    except BreakerOpenError:
        logger.warning("sms_send_breaker_open", to=_masked(to))
        _count("skipped")
        return False
    except Exception as exc:
        logger.warning("sms_send_failed", to=_masked(to), error=type(exc).__name__)
        _count("failed")
        raise

    logger.info("sms_sent", to=_masked(to))
    _count("sent")
    return True


async def dispatch_sms(*, to: str, body: str) -> None:
    """Flag-gated, never-raising hand-off of one SMS (parity with email)."""
    try:
        await send_sms(to=to, body=body)
    except Exception as exc:
        logger.warning("sms_dispatch_failed", to=_masked(to), error=type(exc).__name__)
