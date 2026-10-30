# Local contract snapshot

Regenerate with `pnpm sync-api` (or `.\scripts\sync-api.ps1`):

| file | origin |
| --- | --- |
| `openapi.json` | `..\social-api\contracts\openapi.json` — source for `pnpm gen-types` |
| `api_reference.md` | `..\social-api\contracts\api_reference.md` — read this before touching an endpoint |
| `types.ts` | `..\social-api\contracts\types.ts` — generated request/response shapes |

Never hand-edit these files. The backend is the single source of truth.
