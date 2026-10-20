"""OpenTelemetry tracing setup (no-op when OTEL_ENABLED=false)."""

from __future__ import annotations

from fastapi import FastAPI

from social_api.config import get_settings
from social_api.logging_config import get_logger

logger = get_logger(__name__)


def setup_tracing(app: FastAPI) -> None:
    """Initialize OTel tracing. Skipped if disabled."""
    settings = get_settings()
    if not settings.otel_enabled:
        logger.info("otel_disabled")
        return

    # Imports kept local so disabled mode has zero cost.
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": settings.otel_service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint))
    )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    logger.info("otel_enabled", endpoint=settings.otel_exporter_otlp_endpoint)
