# Local contract snapshot

Regenerate with `pnpm sync-api` (or `.\scripts\sync-api.ps1`):

| file | origin | consumed by |
| --- | --- | --- |
| `openapi.json` | `..\social-api\contracts\openapi.json` | nothing at build time — a snapshot to read |
| `api_reference.md` | `..\social-api\contracts\api_reference.md` | nothing at build time — read this before touching an endpoint |
| `types.ts` | `..\social-api\contracts\types.ts` | `src/mocks/{handlers,fixtures}.ts`, via `../../contracts/types` |

`pnpm gen-types` reads **`../contracts/openapi.json`** (the repo-root copy), not
the `openapi.json` in this folder — see the `gen-types` script in
`package.json`. So a stale snapshot here cannot break `pnpm type-check`; it only
misleads whoever reads it. That is exactly how it drifted before: this table
used to claim `openapi.json` here was the generator's input, so nobody noticed
when the copy fell behind the root one. `types.ts` is the exception — it is a
real import target, so a drift there *does* break the build.

Never hand-edit these files. The backend is the single source of truth.
