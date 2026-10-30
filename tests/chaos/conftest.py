"""Shared chaos-test fixtures.

Requires:
    - docker compose running (docker compose ps shows mysql/redis healthy)
    - uvicorn on http://localhost:8000
    - services are named social-mysql / social-redis (dev compose)

Skipped if Docker isn't running. `pytest -m chaos` to include.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest


def _docker_ok() -> bool:
    if shutil.which("docker") is None:
        return False
    r = subprocess.run(["docker", "info"], capture_output=True, timeout=5, check=False)
    return r.returncode == 0


@pytest.fixture(scope="session")
def docker_available() -> bool:
    return _docker_ok()


@pytest.fixture
def require_docker(docker_available: bool) -> None:
    if not docker_available:
        pytest.skip("Docker not available")
