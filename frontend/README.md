# social-frontend

Next.js 15 (App Router) + React 19 + TypeScript strict frontend for `social-api`.

## Setup

```powershell
pnpm install
pnpm sync-api      # copies contracts from ..\social-api\contracts and regenerates src/types/api.d.ts
pnpm dev           # http://localhost:3000
```

## Scripts

| script                    | purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `dev`                     | Next dev server on :3000                                        |
| `type-check`              | `tsc --noEmit` (strict)                                         |
| `lint`                    | ESLint flat config (`next/core-web-vitals` + `next/typescript`) |
| `format` / `format:check` | Prettier + tailwind class sorting                               |
| `sync-api`                | contract sync + type generation (PowerShell)                    |
| `gen-types`               | `openapi-typescript` from the backend OpenAPI JSON              |

## Docs

- `..\social-api\contracts\api_reference.md` — human-readable API contract (read before touching an endpoint)
- `..\social-api\contracts\types.ts` — generated request/response shapes
- `contracts/openapi.json` — local snapshot used for codegen

## Environment

`.env.local` (gitignored). `.env.example` carries the deployed shape:

```
NEXT_PUBLIC_API_URL=http://localhost
NEXT_PUBLIC_WS_URL=ws://localhost
NEXT_PUBLIC_APP_NAME=Social
```

**Port matters.** The values above are the deployed shape, where nginx listens on
:80 and proxies `/api/v1/*` to the backend container. Locally there is no nginx:
`uvicorn` serves the API directly on :8000, so a dev `.env.local` must carry the
port explicitly —

```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_APP_NAME=Social
```

With the bare origin, every request is refused and the forms surface
`errors.networkError` ("Could not reach the server…") even though the API is up.
These are `NEXT_PUBLIC_*` values: they are inlined into the client bundle, so a
change requires restarting `pnpm dev` (a hot reload is not enough).

## Testing

Vitest + Testing Library + MSW run entirely in jsdom — no backend required.

```powershell
pnpm test        # single run, the CI gate
pnpm test:watch  # watch mode while developing
```

| file                         | purpose                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `vitest.config.ts`           | jsdom environment, `@` alias, `src/**/*.test.ts(x)`                                  |
| `vitest.setup.ts`            | `jest-dom` matchers, browser-API stubs (`matchMedia`, observers), MSW lifecycle      |
| `src/mocks/`                 | contract-accurate handlers + fixtures, typed from `contracts/types.ts`               |
| `src/lib/testing/render.tsx` | `renderWithProviders()` — next-intl + next-themes, same providers as the root layout |

MSW runs with `onUnhandledFrame: 'error'`, so a request with no handler fails the
test instead of silently hitting the network.

Git hooks: `husky` + `lint-staged` run on commit (`eslint --fix` +
`prettier --write` on staged files). The hook bodies live in the **repository-root**
`.husky/` directory, not here — the git toplevel is the parent Python repo, so a
`.husky/` inside `frontend/` is never consulted. `lint-staged.config.mjs` at the
root holds the `frontend/`-prefixed patterns, because lint-staged must run from
the toplevel: it resolves staged paths relative to its own cwd while git reports
them relative to the root. `scripts/prepare-husky.mjs` asks git for the toplevel
and skips installation when there is none, so `pnpm install` stays green in
archives and review sandboxes.
