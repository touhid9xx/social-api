"""
Fail if committed contracts/ is out of sync with current code.

Checks:
  - openapi.json          (byte-equal via JSON dict compare)
  - api_reference.md      (line-by-line, ignores the generated commit SHA)
  - api_reference.xlsx    (cell-by-cell via openpyxl)
  - types.ts              (line-by-line)
  - index.md              (line-by-line, ignores generated_at / commit)

version_manifest.json is regenerated every run (commit SHA + timestamp
change) — not compared.

Usage:
    python scripts/check_api_contract_drift.py
Exit:
    0 = in sync
    1 = drift detected
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

# Force UTF-8 stdout/stderr so the ✓/✗ glyphs print on Windows
# PowerShell (default cp1252 chokes on U+2713).
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from social_api.main import create_app  # noqa: E402

CONTRACTS_DIR = ROOT / "contracts"


def _load_export_module() -> ModuleType:
    """Load scripts/export_api_contract.py by file path.

    `from scripts.export_api_contract import ...` fails when this script
    is run as `python scripts/check_api_contract_drift.py` — Python
    puts scripts/ on sys.path (the running script's directory), not the
    project root, so `scripts` is never resolvable as a package.
    Loading by path bypasses sys.path entirely and is robust to
    working-directory changes.
    """
    spec = importlib.util.spec_from_file_location(
        "export_api_contract",
        ROOT / "scripts" / "export_api_contract.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load scripts/export_api_contract.py — check ROOT path")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_export = _load_export_module()
_write_markdown = _export._write_markdown
_write_excel = _export._write_excel
_write_types_ts = _export._write_types_ts
_write_index_md = _export._write_index_md


def _check_openapi(current_spec: dict[str, Any]) -> bool:
    path = CONTRACTS_DIR / "openapi.json"
    if not path.exists():
        print(f"  ✗ MISSING: {path}")
        return False
    committed = json.loads(path.read_text(encoding="utf-8"))
    if committed == current_spec:
        print(f"  ✓ {path.name}")
        return True
    # Show drift hints
    c_paths = set(committed.get("paths", {}).keys())
    n_paths = set(current_spec.get("paths", {}).keys())
    added, removed = n_paths - c_paths, c_paths - n_paths
    print(f"  ✗ DRIFT: {path.name}")
    if added:
        print(f"      paths added:   {sorted(added)}")
    if removed:
        print(f"      paths removed: {sorted(removed)}")
    c_schemas = set(committed.get("components", {}).get("schemas", {}).keys())
    n_schemas = set(current_spec.get("components", {}).get("schemas", {}).keys())
    if n_schemas - c_schemas:
        print(f"      schemas added: {sorted(n_schemas - c_schemas)}")
    if c_schemas - n_schemas:
        print(f"      schemas removed: {sorted(c_schemas - n_schemas)}")
    return False


GENERATED_COMMIT_PREFIX = "**Generated from commit:**"


def _strip_generated_markers(text: str) -> list[str]:
    """Drop the volatile commit-SHA line before comparing.

    Both api_reference.md and index.md embed the HEAD SHA they were
    generated from. Comparing that line would make these checks pass only
    in the commit that regenerates the bundle and fail in every commit
    after it — churn, not real drift. The SHA is provenance, not
    contract content, so it is excluded here (same reasoning as
    version_manifest.json, which is skipped entirely).
    """
    return [line for line in text.splitlines() if not line.startswith(GENERATED_COMMIT_PREFIX)]


def _check_md(current_spec: dict[str, Any]) -> bool:
    """Regenerate in memory and line-compare (ignoring the commit SHA)."""
    path = CONTRACTS_DIR / "api_reference.md"
    if not path.exists():
        print(f"  ✗ MISSING: {path.name}")
        return False

    with tempfile.NamedTemporaryFile(
        mode="w+", suffix=".md", delete=False, encoding="utf-8"
    ) as tmp:
        tmp_path = Path(tmp.name)

    _write_markdown(tmp_path, current_spec)
    a = _strip_generated_markers(path.read_text(encoding="utf-8"))
    b = _strip_generated_markers(tmp_path.read_text(encoding="utf-8"))
    tmp_path.unlink(missing_ok=True)

    if a == b:
        print(f"  ✓ {path.name}")
        return True
    print(f"  ✗ DRIFT: {path.name} ({len(a)} vs {len(b)} lines)")
    return False


def _check_xlsx(current_spec: dict[str, Any]) -> bool:
    path = CONTRACTS_DIR / "api_reference.xlsx"
    if not path.exists():
        print(f"  ✗ MISSING: {path.name}")
        return False
    try:
        from openpyxl import load_workbook
    except ImportError:
        print(f"  ⚠ {path.name}: openpyxl missing — skipped")
        return True

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    _write_excel(tmp_path, current_spec)

    def _cells(p: Path) -> list[list[Any]]:
        wb = load_workbook(p, read_only=True)
        out: list[list[Any]] = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                out.append(list(row))
        wb.close()
        return out

    a = _cells(path)
    b = _cells(tmp_path)
    tmp_path.unlink(missing_ok=True)

    if a == b:
        print(f"  ✓ {path.name}")
        return True
    print(f"  ✗ DRIFT: {path.name}")
    return False


def _check_types_ts(current_spec: dict[str, Any]) -> bool:
    path = CONTRACTS_DIR / "types.ts"
    if not path.exists():
        print(f"  ✗ MISSING: {path.name}")
        return False
    # If npx generated, output varies by npx version — skip compare and
    # just warn. Fallback generator IS compared.
    if "AUTO-GENERATED by scripts/export_api_contract.py" in path.read_text(encoding="utf-8"):
        with tempfile.NamedTemporaryFile(
            mode="w+", suffix=".ts", delete=False, encoding="utf-8"
        ) as tmp:
            tmp_path = Path(tmp.name)
        _write_types_ts(current_spec, tmp_path)
        a = path.read_text(encoding="utf-8").splitlines()
        b = tmp_path.read_text(encoding="utf-8").splitlines()
        tmp_path.unlink(missing_ok=True)
        if a == b:
            print(f"  ✓ {path.name}")
            return True
        print(f"  ✗ DRIFT: {path.name}")
        return False
    print(f"  ⚠ {path.name}: npx-generated — drift check skipped")
    return True


def _check_index_md(current_spec: dict[str, Any]) -> bool:
    """
    index.md contains generated_at + commit_sha (changes every run).
    We compare structure only: strip the "Generated from commit" line
    before comparing.
    """
    path = CONTRACTS_DIR / "index.md"
    if not path.exists():
        print(f"  ✗ MISSING: {path.name}")
        return False

    with tempfile.NamedTemporaryFile(
        mode="w+", suffix=".md", delete=False, encoding="utf-8"
    ) as tmp:
        tmp_path = Path(tmp.name)

    # Fake manifest — matches the real manifest's shape (endpoints_count /
    # schemas_count / openapi_sha256), so if _write_index_md ever starts
    # consuming those fields the drift check keeps working.
    fake_manifest: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "commit_sha": "0000000000000000000000000000000000000000",
        "openapi_sha256": "0" * 64,
        "endpoints_count": sum(
            len([m for m in methods if m in {"get", "post", "put", "patch", "delete"}])
            for methods in current_spec.get("paths", {}).values()
        ),
        "schemas_count": len(current_spec.get("components", {}).get("schemas", {})),
    }
    _write_index_md(tmp_path, current_spec, fake_manifest)

    a = _strip_generated_markers(path.read_text(encoding="utf-8"))
    b = _strip_generated_markers(tmp_path.read_text(encoding="utf-8"))
    tmp_path.unlink(missing_ok=True)

    if a == b:
        print(f"  ✓ {path.name}")
        return True
    print(f"  ✗ DRIFT: {path.name}")
    return False


def main() -> int:
    print("Checking contract drift ...")
    current_spec = create_app().openapi()

    checks = [
        _check_openapi(current_spec),
        _check_md(current_spec),
        _check_xlsx(current_spec),
        _check_types_ts(current_spec),
        _check_index_md(current_spec),
    ]

    if all(checks):
        print("\nOK: contracts/ is in sync with code.")
        return 0

    print(
        "\nDRIFT DETECTED — contracts/ is stale.\n"
        "Run: python scripts/export_api_contract.py\n"
        "Then commit the updated contracts/ files."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
