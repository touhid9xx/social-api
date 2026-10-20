"""
Fail if committed contracts/openapi.json is out of sync with current code.

Used in CI (and can be run locally before committing).

Usage:
    python scripts/check_api_contract_drift.py
Exit codes:
    0 = in sync
    1 = drift detected
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from social_api.main import create_app  # noqa: E402

CONTRACTS_DIR = ROOT / "contracts"
COMMITTED = CONTRACTS_DIR / "openapi.json"


def main() -> int:
    if not COMMITTED.exists():
        print(f"ERROR: {COMMITTED} does not exist. Run export_api_contract.py first.")
        return 1

    committed = json.loads(COMMITTED.read_text(encoding="utf-8"))
    current = create_app().openapi()

    if committed != current:
        print("DRIFT DETECTED — contracts/openapi.json is stale.")
        print("Run: python scripts/export_api_contract.py")
        # Minimal diff hint
        c_paths = set(committed.get("paths", {}).keys())
        n_paths = set(current.get("paths", {}).keys())
        added = n_paths - c_paths
        removed = c_paths - n_paths
        if added:
            print(f"  Paths added:   {sorted(added)}")
        if removed:
            print(f"  Paths removed: {sorted(removed)}")
        return 1

    print("OK: contracts/openapi.json is in sync with code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
