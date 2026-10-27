"""AsyncCircuitBreaker state machine."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from social_api.core.circuit_breakers import (
    AsyncCircuitBreaker,
    BreakerOpenError,
    BreakerState,
)

pytestmark = pytest.mark.unit


async def _ok() -> str:
    return "ok"


async def _boom() -> str:
    raise RuntimeError("boom")


@pytest.mark.asyncio
async def test_closed_state_passes_through() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=3, recovery_timeout=1.0)
    assert await b.call(_ok) == "ok"
    assert b.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_opens_after_threshold_failures() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=3, recovery_timeout=10.0)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            await b.call(_boom)
    assert b.state == BreakerState.OPEN


@pytest.mark.asyncio
async def test_open_breaker_fast_fails() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=1, recovery_timeout=10.0)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    assert b.state == BreakerState.OPEN

    with pytest.raises(BreakerOpenError):
        await b.call(_ok)  # never called


@pytest.mark.asyncio
async def test_transitions_to_half_open_after_timeout() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=1, recovery_timeout=0.1)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    assert b.state == BreakerState.OPEN
    await asyncio.sleep(0.15)
    assert b.state == BreakerState.HALF_OPEN


@pytest.mark.asyncio
async def test_half_open_success_closes() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=1, recovery_timeout=0.1, success_threshold=1)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    await asyncio.sleep(0.15)

    # One success -> closed
    assert await b.call(_ok) == "ok"
    assert b.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_half_open_fail_reopens() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=1, recovery_timeout=0.1)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    await asyncio.sleep(0.15)

    # Probe fails -> open again
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    assert b.state == BreakerState.OPEN


@pytest.mark.asyncio
async def test_half_open_probe_in_flight_blocks_concurrent() -> None:
    b = AsyncCircuitBreaker(name="t", fail_threshold=1, recovery_timeout=0.1)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    await asyncio.sleep(0.15)

    started = asyncio.Event()
    proceed = asyncio.Event()

    async def slow_ok() -> str:
        started.set()
        await proceed.wait()
        return "ok"

    task = asyncio.create_task(b.call(slow_ok))
    await started.wait()

    # Second call while probe in flight -> fast-fail
    with pytest.raises(BreakerOpenError):
        await b.call(_ok)

    proceed.set()
    await task
    assert b.state == BreakerState.CLOSED


@pytest.mark.asyncio
async def test_breaker_open_error_has_name() -> None:
    b = AsyncCircuitBreaker(name="redis", fail_threshold=1, recovery_timeout=10.0)
    with pytest.raises(RuntimeError):
        await b.call(_boom)
    with pytest.raises(BreakerOpenError) as ei:
        await b.call(_ok)
    assert "redis" in str(ei.value)


@pytest.mark.asyncio
async def test_guarded_redis_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """With breaker open, guarded returns default without calling fn."""
    from social_api.cache.redis import guarded
    from social_api.core import circuit_breakers

    b = circuit_breakers.redis_breaker
    # Force open
    b._state = BreakerState.OPEN
    b._opened_at = 9_999_999_999.0  # far future -> not eligible for half-open

    called: list[Any] = []

    async def fn() -> str:
        called.append(1)
        return "should-not-run"

    result = await guarded(fn, default="fallback", op="test")
    assert result == "fallback"
    assert called == []  # fast-fail

    # Restore
    b._state = BreakerState.CLOSED
    b._fail_count = 0
