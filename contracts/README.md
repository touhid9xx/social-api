# API Contract Bundle

Auto-generated from commit `224772cf3b5e` at 2026-10-30T21:44:28.165228+00:00.

**Do not edit these files by hand.** Regenerate with:

```powershell
python scripts/export_api_contract.py
```

## What's here

| File | Purpose |
|---|---|
| `openapi.json` | OpenAPI 3.1 spec - machine-readable source of truth |
| `api_reference.md` | Human-readable endpoint docs |
| `api_reference.xlsx` | Spreadsheet view for reviews |
| `types.ts` | TypeScript types generated from the OpenAPI schemas |
| `index.md` | Landing page - base URL, auth, conventions |
| `version_manifest.json` | Metadata: generated_at, commit SHA, counts |

## How to consume (frontend project)

### TypeScript (recommended)

Import types directly:

```ts
import type { Post, User, Comment } from './contracts/types';
```

Or generate a client with `openapi-typescript`:

```bash
npx openapi-typescript ./contracts/openapi.json -o ./src/api/schema.ts
```

### Fetch client (framework-agnostic)

```ts
const res = await fetch(`${API_BASE}/api/v1/posts`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  const err = await res.json();
  throw new ApiError(err.error, err.status, err.detail, err.request_id);
}
```

## When this changes

- **Breaking change** -> new `/api/v2/` endpoint, v1 kept alive 12 months
- **Additive change** (new optional field, new endpoint) -> no version bump, regenerate bundle
- **Deprecation** -> `Deprecation` + `Sunset` headers on affected endpoints

## Drift prevention

CI runs `scripts/check_api_contract_drift.py` on every push. If `contracts/openapi.json` is stale relative to `src/`, CI fails. Regenerate locally before committing API changes.
