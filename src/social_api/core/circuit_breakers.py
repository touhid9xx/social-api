"""Async circuit breakers for external dependencies.

A tiny in-process state machine. Multi-worker safe by design — each worker
has its own state. Breakers that share state across workers require a
health-check on their own backend, which is circular.

States:
    CLOSED    — normal; requests flow through.
    OPEN      — fail fast; no requests attempted for `recovery_timeout`.
    HALF_OPEN — after timeout, one probe goes through.
                 Success → CLOSED. Failure → OPEN (timer resets).
"""

from __future__ import annotations

import asyncio
import enum
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

from social_api.logging_config import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class BreakerState(enum.StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class BreakerOpenError(Exception):
    """Raised when a request hits an open breaker."""


class AsyncCircuitBreaker:
    """
    Async circuit breaker.

    Usage:
        breaker = AsyncCircuitBreaker(name="redis", fail_threshold=5,
                                       recovery_timeout=30)
        result = await breaker.call(lambda: my_async_op())
    """

    def __init__(
        self,
        *,
        name: str,
        fail_threshold: int = 5,
        recovery_timeout: float = 30.0,
        success_threshold: int = 1,
    ) -> None:
        self._name = name
        self._fail_threshold = fail_threshold
        self._recovery_timeout = recovery_timeout
        self._success_threshold = success_threshold

        self._state: BreakerState = BreakerState.CLOSED
        self._fail_count = 0
        self._success_count = 0
        self._opened_at: float = 0.0
        self._probe_in_flight = False
        self._lock = asyncio.Lock()

    # ---- Public API ----
    @property
    def name(self) -> str:
        return self._name

    @property
    def state(self) -> BreakerState:
        """
        Effective state (does not mutate `_state`).

        If `_state` is OPEN but the recovery timer has elapsed, report
        HALF_OPEN — callers may attempt a probe. The transition happens
        inside `call()`; this property is read-only.
        """
        if (
            self._state == BreakerState.OPEN
            and time.monotonic() - self._opened_at >= self._recovery_timeout
        ):
            return BreakerState.HALF_OPEN
        return self._state

    def snapshot(self) -> dict[str, object]:
        """For /health/circuit-breakers."""
        return {
            "name": self._name,
            "state": self.state.value,
            "fail_count": self._fail_count,
            "success_count": self._success_count,
            "probe_in_flight": self._probe_in_flight,
            "opened_at": self._opened_at or None,
        }

    async def call(self, fn: Callable[[], Awaitable[T]]) -> T:
        """
        Run `fn()` guarded by the breaker.

        Only one probe is permitted in HALF_OPEN; concurrent callers fast-
        fail with BreakerOpenError while a probe is in flight.
        """
        # ---- Admission decision + probe reservation, atomically ----
        async with self._lock:
            effective = self._effective_state_locked()

            if effective == BreakerState.OPEN:
                logger.debug("breaker_open_fast_fail", name=self._name)
                raise BreakerOpenError(f"Circuit breaker '{self._name}' is open")

            if effective == BreakerState.HALF_OPEN:
                if self._probe_in_flight:
                    logger.debug("breaker_half_open_busy", name=self._name)
                    raise BreakerOpenError(
                        f"Circuit breaker '{self._name}' is half-open (probe in flight)"
                    )
                self._probe_in_flight = True
                # Mark the transition to HALF_OPEN so a second caller that
                # checks `_effective_state_locked` sees HALF_OPEN, not OPEN.
                self._state = BreakerState.HALF_OPEN
                logger.info("breaker_half_open_probe", name=self._name)

        # ---- Execute outside the lock ----
        try:
            result = await fn()
        except Exception as exc:
            # ---- Failure: state transition + probe release, atomically ----
            async with self._lock:
                self._probe_in_flight = False
                await self._on_failure_locked()
            raise exc
        else:
            # ---- Success: state transition + probe release, atomically ----
            async with self._lock:
                self._probe_in_flight = False
                await self._on_success_locked()
            return result

    # ---- State transitions (all require the lock) ----
    def _effective_state_locked(self) -> BreakerState:
        """Same as `state` property but assumes lock is held."""
        if (
            self._state == BreakerState.OPEN
            and time.monotonic() - self._opened_at >= self._recovery_timeout
        ):
            return BreakerState.HALF_OPEN
        return self._state

    async def _on_success_locked(self) -> None:
        """Called under lock. Handles CLOSED (no-op) and HALF_OPEN (close)."""
        prev = self._state
        self._success_count += 1
        self._fail_count = 0

        # HALF_OPEN probe succeeded → close (when success_threshold met).
        # Consecutive successes are counted so callers can require N>1.
        if prev == BreakerState.HALF_OPEN and self._success_count >= self._success_threshold:
            self._state = BreakerState.CLOSED
            self._success_count = 0
            self._opened_at = 0.0
            logger.info("breaker_closed", name=self._name)
            self._emit_state_metric()

    async def _on_failure_locked(self) -> None:
        """Called under lock. Handles CLOSED (accumulate) and HALF_OPEN (reopen)."""
        prev = self._state
        self._fail_count += 1

        if prev == BreakerState.HALF_OPEN:
            # Probe failed → back to OPEN, timer resets
            self._state = BreakerState.OPEN
            self._opened_at = time.monotonic()
            self._success_count = 0
            logger.warning(
                "breaker_reopened",
                name=self._name,
                fail_count=self._fail_count,
            )
            self._emit_state_metric()
            return

        if prev == BreakerState.CLOSED and self._fail_count >= self._fail_threshold:
            self._state = BreakerState.OPEN
            self._opened_at = time.monotonic()
            logger.warning(
                "breaker_opened",
                name=self._name,
                fail_count=self._fail_count,
            )
            self._emit_state_metric()

    def _emit_state_metric(self) -> None:
        """Best-effort metric emission; never fatal.

        Metrics are optional — a Prometheus registry hiccup must not
        take down the breaker. Log at debug so it's traceable in dev.
        """
        try:
            from social_api.observability.metrics import (
                circuit_breaker_state,
            )

            value = {
                BreakerState.CLOSED: 0,
                BreakerState.HALF_OPEN: 1,
                BreakerState.OPEN: 2,
            }[self._state]
            circuit_breaker_state.labels(name=self._name).set(value)
        except Exception as exc:  # pragma: no cover — metrics optional
            logger.debug(
                "breaker_metric_emit_failed",
                name=self._name,
                error=type(exc).__name__,
            )


# ---------------------------------------------------------------------------
# Singleton breakers for all external dependencies
# ---------------------------------------------------------------------------
redis_breaker = AsyncCircuitBreaker(name="redis", fail_threshold=5, recovery_timeout=30.0)
smtp_breaker = AsyncCircuitBreaker(name="smtp", fail_threshold=3, recovery_timeout=60.0)
s3_breaker = AsyncCircuitBreaker(name="s3", fail_threshold=5, recovery_timeout=60.0)


def all_breakers() -> list[AsyncCircuitBreaker]:
    return [redis_breaker, smtp_breaker, s3_breaker]
