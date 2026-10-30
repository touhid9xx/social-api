# syntax=docker/dockerfile:1.7
# =============================================================================
# Stage 1 — builder
# =============================================================================
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps: gcc for C extensions (asyncmy, cryptography, argon2-cffi),
# libffi-dev for cryptography, libssl-dev for TLS.
# NOTE: default-libmysqlclient-dev is NOT needed — asyncmy uses its own
# Cython C-extension for the MySQL wire protocol, not libmysqlclient.
# Dropped to save ~40 MB and a couple of build minutes.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Create venv in builder — copied wholesale to runtime
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

WORKDIR /app

# ---- Layered cache: pyproject.toml + README first ----
# These change rarely, so this COPY stays cached even when src/ changes.
COPY pyproject.toml README.md /app/

# ---- Copy the package source ----
# Non-editable `pip install .` runs setuptools egg_info against the
# working dir. pyproject.toml declares a src/ layout, so src/ must be
# present before pip install or egg_info fails with
#   "egg_base: 'src' does not exist or is not a directory"
COPY src /app/src

# ---- Install into /venv (production extras only, no [dev]) ----
RUN pip install --upgrade pip && pip install ".[s3,prod]"

# =============================================================================
# Stage 2 — runtime
# =============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/venv/bin:$PATH"
# PYTHONPATH intentionally NOT set. The wheel is installed into the
# venv's site-packages — setting PYTHONPATH=/app/src would shadow the
# installed package with the source tree, which is subtly different
# (missing dist-info, breaks importlib.resources, confuses __file__
# consumers). If you ever need source-tree priority for local dev, set
# PYTHONPATH in your shell — not in the runtime image.

# Runtime deps only: libmagic1 for python-magic, curl for the container
# healthcheck. ca-certificates is already in python:3.12-slim — no need
# to reinstall.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libmagic1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed venv from builder
COPY --from=builder /venv /venv

WORKDIR /app

# ---- Copy runtime artifacts ----
# src/ is copied for two reasons:
#   1. Alembic discovers migration scripts via src layout in some setups.
#   2. Any code that reads package data (i18n messages, templates) uses
#      relative paths against the source tree. Installed wheel also has
#      it, but keeping the source tree aligned avoids surprises.
COPY src         /app/src
COPY alembic     /app/alembic
COPY alembic.ini /app/alembic.ini
COPY scripts     /app/scripts

# deploy/ holds docker-entrypoint.sh (and nginx.conf, which is not used
# by this container). Kept because ENTRYPOINT references it.
# ALTERNATIVE (cleaner): move docker-entrypoint.sh to scripts/ and drop
# this COPY — then deploy/ can stay in .dockerignore.
COPY deploy      /app/deploy

# Entrypoint must be executable
RUN chmod +x /app/deploy/docker-entrypoint.sh

# Data dirs (mounted as volumes in compose). Created BEFORE `USER
# appuser` so ownership is correct — the volume mount inherits the
# directory's owner from the image, and `appuser` needs write access
# to /app/data/media for the first upload to succeed.
RUN mkdir -p /app/data/media /app/secrets

# Non-root user — uid 10001 must match ci.yml's
# `[ "$USER_ID" = "10001" ]` assertion AND docker-compose.prod.yml's
# `user: "10001:10001"`.
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -m -s /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Healthcheck: readiness (DB + Redis probes)
HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=5 \
    CMD curl -fsS http://localhost:8000/health/ready || exit 1

EXPOSE 8000

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
CMD ["api"]
