"""Contract export script runs end-to-end without raising."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]


def _import_export_module() -> ModuleType:
    """Import scripts/export_api_contract.py by file path.

    scripts/ is not on sys.path by default — it's a scripts directory,
    not a package. Inserting ROOT/scripts into sys.path once lets
    importlib find it.
    """
    scripts_dir = str(ROOT / "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    return importlib.import_module("export_api_contract")


def test_main_writes_all_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """main() should produce all 7 contract artifacts in CONTRACTS_DIR."""
    export_mod = _import_export_module()
    monkeypatch.setattr(export_mod, "CONTRACTS_DIR", tmp_path)

    export_mod.main()

    expected = [
        "openapi.json",
        "api_reference.md",
        "api_reference.xlsx",
        "types.ts",
        "index.md",
        "README.md",
        "version_manifest.json",
    ]
    for fname in expected:
        p = tmp_path / fname
        assert p.exists(), f"missing: {fname}"
        assert p.stat().st_size > 0, f"empty: {fname}"


def test_manifest_shape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """version_manifest.json has the expected keys and types."""
    export_mod = _import_export_module()
    monkeypatch.setattr(export_mod, "CONTRACTS_DIR", tmp_path)

    export_mod.main()

    manifest = json.loads((tmp_path / "version_manifest.json").read_text())
    assert "generated_at" in manifest
    assert "commit_sha" in manifest
    assert "openapi_sha256" in manifest
    assert isinstance(manifest["endpoints_count"], int)
    assert isinstance(manifest["schemas_count"], int)
    assert manifest["endpoints_count"] > 0
    assert manifest["schemas_count"] > 0
