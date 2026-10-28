"""Entrypoint-time secrets bootstrap.

Loads secrets from the configured provider (env by default, AWS if
SECRETS_BACKEND=aws) into os.environ so Settings can read them.

Called from deploy/docker-entrypoint.sh before the api/worker/beat role
starts. Idempotent — existing env wins.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add src/ to path (running as script)
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from social_api.core.secrets import bootstrap_env_from_provider  # noqa: E402
from social_api.logging_config import configure_logging, get_logger  # noqa: E402


def main() -> int:
    configure_logging()
    log = get_logger("bootstrap")

    # Support JWT keys stored in AWS SM as string blobs — write to files.
    jwt_private = os.environ.get("JWT_PRIVATE_KEY_CONTENT")
    jwt_public = os.environ.get("JWT_PUBLIC_KEY_CONTENT")
    if jwt_private:
        path = os.environ.get("JWT_PRIVATE_KEY_PATH", "/app/secrets/jwt_private.pem")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(jwt_private, encoding="utf-8")
        Path(path).chmod(0o600)
        log.info("jwt_private_key_written", path=path)
    if jwt_public:
        path = os.environ.get("JWT_PUBLIC_KEY_PATH", "/app/secrets/jwt_public.pem")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(jwt_public, encoding="utf-8")
        Path(path).chmod(0o644)
        log.info("jwt_public_key_written", path=path)

    populated = bootstrap_env_from_provider()
    log.info("bootstrap_done", populated=populated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
