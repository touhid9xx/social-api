"""Verify the committed contract matches the current app schema.

This is the *unit-level* twin of scripts/check_api_contract_drift.py.
It runs in-process so CI catches drift even if the script step is
skipped or the working directory differs.

If this fails, run: python scripts/export_api_contract.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

from social_api.main import create_app

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
COMMITTED = ROOT / "contracts" / "openapi.json"


def test_contract_file_exists() -> None:
    assert COMMITTED.exists(), (
        "contracts/openapi.json missing. Run: python scripts/export_api_contract.py"
    )


def test_contract_matches_current_app() -> None:
    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))
    current = create_app().openapi()

    # Compare the important top-level pieces (paths + component schemas).
    # Ignore the whole-dict compare because 'info' can drift cosmetically.
    committed_paths = set(committed.get("paths", {}).keys())
    current_paths = set(current.get("paths", {}).keys())
    assert current_paths == committed_paths, (
        "API paths drifted from contracts/openapi.json. "
        "Run: python scripts/export_api_contract.py and commit."
    )

    committed_schemas = set(committed.get("components", {}).get("schemas", {}).keys())
    current_schemas = set(current.get("components", {}).get("schemas", {}).keys())
    assert current_schemas == committed_schemas, (
        "Component schemas drifted. Run: python scripts/export_api_contract.py."
    )


def test_contract_is_valid_json_schema() -> None:
    """Basic sanity: openapi has expected top-level keys."""
    spec = json.loads(COMMITTED.read_text(encoding="utf-8"))
    assert spec["openapi"].startswith("3.")
    assert "info" in spec
    assert "paths" in spec


def _load_drift_module() -> ModuleType:
    """Load scripts/check_api_contract_drift.py by path.

    Same technique the drift script itself uses for the exporter: the
    repo root is not guaranteed to be importable as a package from the
    pytest working directory, so load by file path.
    """
    spec = importlib.util.spec_from_file_location(
        "check_api_contract_drift",
        ROOT / "scripts" / "check_api_contract_drift.py",
    )
    assert spec is not None
    assert spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_generated_commit_line_is_stripped() -> None:
    """The provenance line must not participate in the comparison.

    api_reference.md embeds the HEAD SHA it was generated from, which
    can never match the committed copy after the generating commit. If
    that line is compared, the whole backend unit suite goes red on
    every commit that does not regenerate contracts.
    """
    drift = _load_drift_module()
    text = (
        "# API — API Reference\n"
        "**Version:** `0.1.0`\n"
        "**Generated from commit:** `deadbeef1234`\n"
        "---\n"
    )
    stripped = drift._strip_generated_markers(text)
    assert stripped == ["# API — API Reference", "**Version:** `0.1.0`", "---"]
    assert not any("Generated from commit" in line for line in stripped)


def test_markdown_drift_check_tolerates_commit_mismatch() -> None:
    """Functional twin: a stale SHA alone must not read as drift.

    The committed api_reference.md was generated from an older commit
    than HEAD, so its SHA line differs by construction. _check_md must
    still report in-sync.
    """
    drift = _load_drift_module()
    committed = (ROOT / "contracts" / "api_reference.md").read_text(encoding="utf-8")
    assert "**Generated from commit:**" in committed, (
        "api_reference.md is expected to carry a provenance line; "
        "if the generator stopped emitting it, drop this assertion."
    )
    assert drift._check_md(create_app().openapi()) is True


def test_all_contracts_in_sync() -> None:
    """Verify all artifacts match current code.

    Runs the drift script as a subprocess so it's the same gate CI
    uses. PYTHONIOENCODING=utf-8 forces UTF-8 stdout — on Windows,
    Python's default cp1252 cannot encode the checkmark glyphs the
    script prints, which crashed an earlier run with UnicodeEncodeError
    rather than a real drift signal.
    """
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        [sys.executable, "scripts/check_api_contract_drift.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        env=env,
    )
    assert result.returncode == 0, (
        f"Contract drift detected:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
