"""Tracing helpers are no-op safe."""

from __future__ import annotations

import pytest

from social_api.core.tracing_helpers import span

pytestmark = pytest.mark.unit


def test_span_no_op_when_disabled() -> None:
    # OTEL_ENABLED not set -> tracer still returns but is no-op
    with span("test.op", {"k": "v"}):
        assert True


def test_span_nested() -> None:
    with span("outer"), span("inner"):
        assert True


def test_span_handles_exception_in_attributes() -> None:
    # Objects not JSON-serializable as attributes -> must not crash
    with span("test.bad_attr", {"obj": object()}):
        assert True
