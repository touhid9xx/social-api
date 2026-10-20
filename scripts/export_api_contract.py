"""
Export the API contract for frontend handoff.

Outputs (all into contracts/):
  - openapi.json          (machine-readable, FastAPI-generated)
  - api_reference.md      (human-readable endpoint list)
  - api_reference.xlsx    (spreadsheet view)
  - types.ts              (optional; requires Node `json-schema-to-typescript`)

Usage (PowerShell):
    python scripts/export_api_contract.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# Ensure src/ on path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from social_api.main import create_app  # noqa: E402

CONTRACTS_DIR = ROOT / "contracts"


def _dump_openapi(app: Any) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    return app.openapi()


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _md_escape(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def _write_markdown(path: Path, spec: dict[str, Any]) -> None:
    lines: list[str] = []
    lines.append(f"# {spec['info'].get('title', 'API')} — API Reference\n")
    lines.append(f"Version: `{spec['info'].get('version', '?')}`\n")
    servers = spec.get("servers") or [{}]
    base_url = servers[0].get("url", "/")
    lines.append(f"Base URL: `{base_url}`\n")
    lines.append("---\n")
    lines.append("## Endpoints\n")

    for path_url, methods in sorted(spec.get("paths", {}).items()):
        for method, op in sorted(methods.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            summary = op.get("summary", "")
            tags = ", ".join(op.get("tags", []))
            op_id = op.get("operationId", "")
            lines.append(f"### `{method.upper()}` {path_url}\n")
            if summary:
                lines.append(f"**Summary:** {_md_escape(summary)}\n")
            if tags:
                lines.append(f"**Tags:** {tags}\n")
            if op_id:
                lines.append(f"**operationId:** `{op_id}`\n")

            # Security
            sec = op.get("security")
            if sec:
                lines.append(f"**Auth:** {json.dumps(sec)}\n")

            # Parameters
            params = op.get("parameters", [])
            if params:
                lines.append("\n**Parameters:**\n")
                lines.append("| Name | In | Required | Schema |")
                lines.append("|---|---|---|---|")
                for p in params:
                    schema = p.get("schema", {})
                    schema_str = json.dumps(schema, ensure_ascii=False)
                    lines.append(
                        f"| {p.get('name')} | {p.get('in')} | {p.get('required', False)} | "
                        f"`{_md_escape(schema_str)}` |"
                    )
                lines.append("")

            # Request body
            rb = op.get("requestBody")
            if rb:
                content = rb.get("content", {})
                lines.append("\n**Request Body:**\n")
                for ctype, media in content.items():
                    schema_ref = media.get("schema", {}).get("$ref", "")
                    lines.append(f"- `{ctype}` -> `{schema_ref or 'inline'}`")
                lines.append("")

            # Responses
            lines.append("\n**Responses:**\n")
            for code, resp in sorted(op.get("responses", {}).items(), key=lambda x: str(x[0])):
                desc = resp.get("description", "")
                lines.append(f"- `{code}` — {_md_escape(desc)}")
            lines.append("\n---\n")

    path.write_text("\n".join(lines), encoding="utf-8")


def _write_excel(path: Path, spec: dict[str, Any]) -> None:
    try:
        from openpyxl import Workbook
    except ImportError:
        print("  ! openpyxl not installed — skipping XLSX")
        return

    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Endpoints"
    ws.append(
        [
            "Method",
            "Path",
            "Summary",
            "Tags",
            "Auth",
            "Request Schema",
            "Response Codes",
        ]
    )

    for path_url, methods in sorted(spec.get("paths", {}).items()):
        for method, op in sorted(methods.items()):
            if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                continue
            request_ref = ""
            rb = op.get("requestBody")
            if rb:
                for media in rb.get("content", {}).values():
                    ref = media.get("schema", {}).get("$ref", "")
                    if ref:
                        request_ref = ref.rsplit("/", 1)[-1]
                        break
            response_codes = ", ".join(
                str(c) for c in sorted(op.get("responses", {}).keys(), key=str)
            )
            auth = (
                " | ".join(op.get("security", [{}])[0].keys()) if op.get("security") else "public"
            )
            ws.append(
                [
                    method.upper(),
                    path_url,
                    op.get("summary", ""),
                    ", ".join(op.get("tags", [])),
                    auth,
                    request_ref,
                    response_codes,
                ]
            )

    # Second sheet: schemas
    ws2 = wb.create_sheet("Schemas")
    ws2.append(["Name", "Type", "Properties"])
    for name, schema in sorted(spec.get("components", {}).get("schemas", {}).items()):
        props = ", ".join(schema.get("properties", {}).keys())
        ws2.append([name, schema.get("type", ""), props])

    wb.save(path)


def _write_types_ts(spec: dict[str, Any], path: Path) -> None:
    """Convert component schemas to TypeScript types. No Node needed for M0."""
    components = spec.get("components", {}).get("schemas", {})
    if not components:
        path.write_text("// (no schemas yet)\n", encoding="utf-8")
        return

    def _json_type_to_ts(schema: dict[str, Any]) -> str:
        t = schema.get("type")
        if t == "string":
            return "string"
        if t == "integer" or t == "number":
            return "number"
        if t == "boolean":
            return "boolean"
        if t == "array":
            return f"{_json_type_to_ts(schema.get('items', {}))}[]"
        if t == "object":
            return "Record<string, unknown>"
        return "unknown"

    lines: list[str] = [
        "// AUTO-GENERATED by scripts/export_api_contract.py",
        "// Source: contracts/openapi.json",
        "",
    ]
    for name, schema in sorted(components.items()):
        props = schema.get("properties", {})
        required = set(schema.get("required", []))
        lines.append(f"export interface {name} {{")
        for pname, pschema in props.items():
            optional = "" if pname in required else "?"
            t = _json_type_to_ts(pschema)
            lines.append(f"  {pname}{optional}: {t};")
        lines.append("}\n")

    path.write_text("\n".join(lines), encoding="utf-8")


def _try_generate_types_via_node(output_path: Path) -> bool:
    """
    Attempt to generate types.ts via `npx json-schema-to-typescript`.

    Returns True if the tool ran successfully, False otherwise.
    S603/S607: safe — argv is fixed, shell=False, no untrusted input,
    dev-only script, and executable path is resolved via shutil.which.
    """
    node = shutil.which("node")
    if not node:
        return False
    npx = shutil.which("npx")
    if not npx:
        return False
    try:
        subprocess.run(  # noqa: S603
            [
                npx,
                "--yes",
                "json-schema-to-typescript",
                "-i",
                str(CONTRACTS_DIR / "openapi.json"),
                "-o",
                str(output_path),
            ],
            check=False,
            timeout=60,
        )
    except Exception as exc:  # pragma: no cover
        print(f"      ! npx failed ({exc}); using fallback generator")
        return False
    return output_path.exists()


def main() -> int:
    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/4] Generating openapi.json ...")
    app = create_app()
    spec = _dump_openapi(app)
    _write_json(CONTRACTS_DIR / "openapi.json", spec)
    print(f"      -> {CONTRACTS_DIR / 'openapi.json'}")

    print("[2/4] Generating api_reference.md ...")
    _write_markdown(CONTRACTS_DIR / "api_reference.md", spec)
    print(f"      -> {CONTRACTS_DIR / 'api_reference.md'}")

    print("[3/4] Generating api_reference.xlsx ...")
    _write_excel(CONTRACTS_DIR / "api_reference.xlsx", spec)
    print(f"      -> {CONTRACTS_DIR / 'api_reference.xlsx'}")

    print("[4/4] Generating types.ts ...")
    types_path = CONTRACTS_DIR / "types.ts"
    if not _try_generate_types_via_node(types_path):
        _write_types_ts(spec, types_path)
    print(f"      -> {types_path}")

    print("\nDone. Contracts written to ./contracts/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
