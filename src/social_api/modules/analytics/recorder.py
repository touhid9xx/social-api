"""Buffered, consent-gated visit recorder.

Design constraints that shaped this module:

* **Never on the request path.** `record_request()` is synchronous and only
  appends to a bounded in-memory list — no awaits, no I/O. A background task
  flushes batches on an interval (`analytics_flush_seconds`) or as soon as the
  buffer reaches `analytics_buffer_size`.
* **Consent is resolved once per batch, not per request.** Authenticated
  events carry a transient `user_id` in memory only; `flush()` resolves
  `ConsentChannel.ANALYTICS` for the whole batch in a single query and drops
  the events of anyone who has not granted it. The user id is never written
  to the analytics table.
* **Unique visitors are estimates, not identities.** Each flush feeds the
  Redis HyperLogLog set for the day with an HMAC of `ip|user-agent` keyed by a
  per-day pepper. The hash is never persisted and rotates daily, so two days'
  sketches cannot be joined.
* **Failure is silent by contract.** If the DB or Redis is down the batch is
  dropped with a warning; analytics must never fail a request or crash the
  app.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import ipaddress
import random
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final

from sqlalchemy import select

from social_api.cache.keys import RedisKeys
from social_api.cache.redis import get_redis
from social_api.config import get_settings
from social_api.db.session import get_sessionmaker
from social_api.logging_config import get_logger
from social_api.modules.analytics.geo import GeoLocation, get_geo_resolver
from social_api.modules.analytics.models import AnalyticsVisit, PathClass
from social_api.modules.users.models import ConsentChannel, UserConsent

logger = get_logger(__name__)

# Never recorded: k8s/ALB probes, Prometheus scraping (every 15s), static
# media, generated docs, and the WebSocket upgrade (long-lived, one row per
# connection says nothing useful).
_IGNORED_PREFIXES: Final[tuple[str, ...]] = (
    "/health",
    "/metrics",
    "/static",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/_i18n_demo",
    "/api/v1/ws",
)

# First path segment after /api/v1 -> bucket. Anything unmapped is OTHER.
_SEGMENT_CLASSES: Final[dict[str, PathClass]] = {
    "auth": PathClass.AUTH,
    "feed": PathClass.FEED,
    "posts": PathClass.POSTS,
    "comments": PathClass.COMMENTS,
    "likes": PathClass.POSTS,
    "media": PathClass.MEDIA,
    "chat": PathClass.CHAT,
    "search": PathClass.SEARCH,
    "users": PathClass.PROFILE,
    "follows": PathClass.PROFILE,
    "gdpr": PathClass.PROFILE,
    "presence": PathClass.PROFILE,
    "notifications": PathClass.NOTIFICATIONS,
    "admin": PathClass.ADMIN,
    "audit": PathClass.ADMIN,
    "flags": PathClass.ADMIN,
    "moderation": PathClass.ADMIN,
}

# Safety valve: a batch never exceeds this, so one flush can't build a
# multi-megabyte INSERT.
_FLUSH_MAX: Final[int] = 1_000
# Hard cap on buffered events. Beyond this new events are dropped (and
# counted) rather than growing memory without bound during a DB outage.
_BUFFER_CEILING_FACTOR: Final[int] = 8


@dataclass(frozen=True, slots=True)
class VisitEvent:
    """One request, held in memory between flushes.

    `user_id`, `ip` and `user_agent` are **transient** — they exist only to
    resolve consent, geo and the visitor hash, and are discarded by `flush()`.
    """

    day: date
    path_class: str
    status_code: int
    latency_ms: int
    weight: int
    user_id: int | None
    ip: str | None
    user_agent: str | None


_buffer: list[VisitEvent] = []
_dropped: int = 0
_task: asyncio.Task[None] | None = None
_running = False


def classify_path(path: str) -> str | None:
    """Map a request path to a `PathClass` value, or None to skip it."""
    for prefix in _IGNORED_PREFIXES:
        if path.startswith(prefix):
            return None

    api_prefix = get_settings().api_v1_prefix.rstrip("/")
    if not path.startswith(f"{api_prefix}/"):
        return PathClass.OTHER.value

    remainder = path[len(api_prefix) + 1 :]
    segment = remainder.split("/", 1)[0]
    if not segment:
        return PathClass.OTHER.value
    klass = _SEGMENT_CLASSES.get(segment)
    return klass.value if klass is not None else PathClass.OTHER.value


def _sample_weight() -> int | None:
    """Return the row weight to use, or None when this request is sampled out."""
    settings = get_settings()
    rate = settings.analytics_sample_rate
    if rate >= 1.0:
        return 1
    if rate <= 0.0:
        return None
    if random.random() >= rate:  # nosec B311  # noqa: S311 — sampling, not crypto
        return None
    return max(1, round(1.0 / rate))


def record_request(
    *,
    path: str,
    status_code: int,
    latency_ms: int,
    user_id: int | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Queue one request for recording. Never raises, never blocks.

    Called from `RequestContextMiddleware` after the response is produced, so
    the work it does has to be effectively free: a few dict lookups, a random
    draw, and a list append.
    """
    global _dropped

    settings = get_settings()
    if not settings.analytics_enabled:
        return

    cap = settings.analytics_buffer_size * _BUFFER_CEILING_FACTOR
    if len(_buffer) >= cap:
        _dropped += 1
        return

    path_class = classify_path(path)
    if path_class is None:
        return
    weight = _sample_weight()
    if weight is None:
        return

    _buffer.append(
        VisitEvent(
            day=datetime.now(UTC).date(),
            path_class=path_class,
            status_code=status_code,
            latency_ms=max(0, latency_ms),
            weight=weight,
            user_id=user_id,
            ip=ip,
            user_agent=(user_agent or None),
        )
    )


def _visitor_hash(ip: str | None, user_agent: str | None, day: date) -> str | None:
    """Daily-rotating one-way visitor fingerprint for the HLL counters.

    Returns None for absent or non-global IPs: proxies, loopback and health
    checks are not visitors.
    """
    if not ip:
        return None
    try:
        if not ipaddress.ip_address(ip).is_global:
            return None
    except ValueError:
        return None

    settings = get_settings()
    pepper = settings.analytics_hash_salt or f"{settings.app_name}:{day.isoformat()}"
    return hmac.new(
        pepper.encode("utf-8"),
        f"{ip}|{user_agent or ''}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def _granted_analytics_consent(user_ids: set[int]) -> set[int]:
    """Users who currently hold an active ANALYTICS grant.

    Mirrors `ConsentRepository.get_active`: the current state is a row with
    `granted=True AND revoked_at IS NULL` — revoking stamps `revoked_at` on
    that same row, so it stops matching.
    """
    if not user_ids:
        return set()
    stmt = select(UserConsent.user_id).where(
        UserConsent.user_id.in_(user_ids),
        UserConsent.channel == ConsentChannel.ANALYTICS,
        UserConsent.granted.is_(True),
        UserConsent.revoked_at.is_(None),
    )
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        result = await session.execute(stmt)
        return {int(uid) for uid in result.scalars().all()}


async def _push_unique_visitors(per_day: dict[str, set[str]]) -> None:
    """PFADD each day's visitor hashes into its HyperLogLog set."""
    if not per_day:
        return
    settings = get_settings()
    ttl = max(1, settings.analytics_retention_days) * 86_400
    try:
        client = get_redis()
        pipe = client.pipeline()
        for key, members in per_day.items():
            pipe.pfadd(key, *members)
            pipe.expire(key, ttl)
        await pipe.execute()
    except Exception as exc:
        logger.debug("analytics_unique_push_failed", error=type(exc).__name__)


async def flush() -> int:
    """Drain the buffer into `analytics_visit`. Returns rows written."""
    global _dropped

    if not _buffer:
        return 0

    batch = _buffer[:_FLUSH_MAX]
    del _buffer[: len(batch)]
    dropped = _dropped
    _dropped = 0

    geo = get_geo_resolver()

    try:
        authed_ids = {e.user_id for e in batch if e.user_id is not None}
        allowed = await _granted_analytics_consent({i for i in authed_ids if i is not None})
    except Exception as exc:
        logger.warning(
            "analytics_consent_check_failed",
            error=type(exc).__name__,
            dropped=len(batch),
        )
        return 0

    rows: list[AnalyticsVisit] = []
    per_day: dict[str, set[str]] = {}
    for event in batch:
        if event.user_id is not None and event.user_id not in allowed:
            # Signed in without an active ANALYTICS grant: never recorded.
            continue
        location: GeoLocation | None = geo.resolve(event.ip)
        rows.append(
            AnalyticsVisit(
                day=event.day,
                path_class=event.path_class,
                is_authenticated=event.user_id is not None,
                status_code=event.status_code,
                latency_ms=event.latency_ms,
                country=location.country if location else None,
                city=location.city if location else None,
                timezone=location.timezone if location else None,
                weight=event.weight,
            )
        )
        fingerprint = _visitor_hash(event.ip, event.user_agent, event.day)
        if fingerprint is not None:
            key = RedisKeys.analytics_unique_visitors(event.day.isoformat())
            per_day.setdefault(key, set()).add(fingerprint)

    if not rows:
        if dropped:
            logger.debug("analytics_batch_fully_dropped", dropped=dropped)
        return 0

    try:
        sessionmaker = get_sessionmaker()
        async with sessionmaker() as session:
            session.add_all(rows)
            await session.commit()
    except Exception as exc:
        logger.warning(
            "analytics_flush_failed",
            error=type(exc).__name__,
            rows=len(rows),
            dropped=dropped,
        )
        return 0

    await _push_unique_visitors(per_day)
    if dropped:
        logger.warning("analytics_events_dropped", count=dropped)
    logger.debug("analytics_flushed", rows=len(rows))
    return len(rows)


async def _run() -> None:
    """Background loop: flush on interval, or sooner when the buffer fills."""
    settings = get_settings()
    interval = max(0.05, settings.analytics_flush_seconds)
    tick = min(0.5, interval)
    elapsed = 0.0
    while _running:
        await asyncio.sleep(tick)
        elapsed += tick
        if not _buffer:
            elapsed = 0.0
            continue
        if len(_buffer) >= settings.analytics_buffer_size or elapsed >= interval:
            elapsed = 0.0
            try:
                await flush()
            except Exception as exc:
                logger.warning("analytics_flush_loop_error", error=type(exc).__name__)


def start() -> None:
    """Start the background flusher (idempotent). Call from app lifespan."""
    global _task, _running
    if _task is not None and not _task.done():
        return
    _running = True
    _task = asyncio.create_task(_run(), name="analytics-flusher")
    logger.info("analytics_recorder_started")


async def stop() -> None:
    """Stop the flusher and drain whatever is buffered."""
    global _task, _running
    _running = False
    task = _task
    _task = None
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    try:
        written = await flush()
        if written:
            logger.info("analytics_drained_on_shutdown", rows=written)
    except Exception as exc:
        logger.warning("analytics_shutdown_flush_failed", error=type(exc).__name__)


def buffered_count() -> int:
    """Number of events waiting to be flushed — diagnostics and tests."""
    return len(_buffer)


def reset() -> None:
    """Clear all module state — tests only."""
    global _dropped, _task, _running
    _buffer.clear()
    _dropped = 0
    _task = None
    _running = False
