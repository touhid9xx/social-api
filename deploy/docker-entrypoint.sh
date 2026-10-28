#!/bin/sh
# Docker entrypoint — dispatches on $1 to one of several roles.
#
# Usage:
#   docker run <image> api       # gunicorn + uvicorn workers (default)
#   docker run <image> worker    # celery worker
#   docker run <image> beat      # celery beat
#   docker run <image> migrate   # alembic upgrade head, then exit
#   docker run <image> shell     # debugging shell
#
# Secrets bootstrap runs first on EVERY role — because SECRETS_BACKEND
# (env / aws-secrets-manager / ssm) is a process-wide choice, not a role
# choice. Each container (api / worker / beat / migrate) must have its
# secrets in-process regardless of which role it plays.

set -e

# ---------------------------------------------------------------------------
# Secrets bootstrap (idempotent, non-fatal on failure)
# ---------------------------------------------------------------------------
# - SECRETS_BACKEND=env      → no-op if env vars already populated; exits 0.
# - SECRETS_BACKEND=aws-secrets-manager / ssm → fetches into env of THIS
#   process. Note: `exec` on the final line means the fetched env stays
#   alive for the child process — without `exec`, secrets would be lost
#   when the entrypoint (shell) exits.
# - SECRETS_BACKEND=skip     → explicit opt-out for tests / one-off shells.
#
# Never fail the container on bootstrap error — log and continue with
# whatever env is already present. Rationale: a startup failure during a
# transient SM outage is worse than a loud warning + broken-health
# surface (readiness endpoint exposes missing secrets).
if [ "${SECRETS_BACKEND:-env}" != "skip" ]; then
    if [ -f /app/scripts/bootstrap_secrets.py ]; then
        python /app/scripts/bootstrap_secrets.py || {
            echo "!! secrets bootstrap failed; continuing with env" >&2
        }
    else
        echo "!! bootstrap_secrets.py not found; skipping (env-only mode)" >&2
    fi
fi

# ---------------------------------------------------------------------------
# Role dispatcher
# ---------------------------------------------------------------------------
ROLE="${1:-api}"

case "$ROLE" in
  api)
    echo ">> [api] starting gunicorn (${GUNICORN_WORKERS:-4} workers)"
    exec gunicorn social_api.main:app \
      --worker-class uvicorn.workers.UvicornWorker \
      --workers "${GUNICORN_WORKERS:-4}" \
      --bind "0.0.0.0:${APP_PORT:-8000}" \
      --timeout 60 \
      --graceful-timeout 30 \
      --keep-alive 5 \
      --access-logfile - \
      --error-logfile -
    ;;

  worker)
    POOL="${CELERY_POOL:-prefork}"
    echo ">> [worker] starting celery worker pool=$POOL concurrency=${CELERY_CONCURRENCY:-4}"
    exec celery -A social_api.workers.celery_app worker \
      --loglevel=info \
      --concurrency="${CELERY_CONCURRENCY:-4}" \
      -P "$POOL"
    ;;

  beat)
    echo ">> [beat] starting celery beat"
    exec celery -A social_api.workers.celery_app beat --loglevel=info
    ;;

  migrate)
    echo ">> [migrate] alembic upgrade head"
    exec alembic upgrade head
    ;;

  shell)
    exec /bin/bash
    ;;

  *)
    # Fallthrough: allow `docker run <image> /bin/sh -c 'psql ...'` for
    # one-off commands without needing a new role. Keeps the entrypoint
    # ergonomic for debugging.
    echo "!! unknown role: $ROLE — falling through to exec $@" >&2
    exec "$@"
    ;;
esac
