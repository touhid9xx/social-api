# Social API — Modular Monolith Backend

[![CI](https://github.com/touhid9xx/social-api/actions/workflows/ci.yml/badge.svg)](https://github.com/touhid9xx/social-api/actions/workflows/ci.yml)
![Python 3.12](https://img.shields.io/badge/python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)
![Coverage](https://img.shields.io/badge/coverage-63%25-yellowgreen)

Production-grade social media backend (Facebook-like) — Python 3.12 + FastAPI,
modular monolith — plus the Next.js client that consumes it.

## Status

**Backend: complete.** All backend milestones (M0–M26) are implemented: auth and
sessions, users/profiles/consent/GDPR, follows/blocks/mutes, posts/comments/likes,
media, three feed strategies, notifications, 1-1 and group chat, moderation, audit,
idempotency, feature flags, presence, WebSockets, and observability. API, Celery
worker and scheduler, migrations, container images, contracts, ADRs and runbook are
all in place and gated by CI.

**Frontend: in progress.** The Next.js app in [`frontend/`](frontend/README.md)
covers the landing page; auth (sign in, sign up, verify email, forgot and reset
password); home and explore feeds; post detail with comments; notifications; chat
room list and message threads; profiles with the follow graph, followers/following
lists and a photo gallery; settings (profile, avatar, consent, GDPR export and
account deletion); and the `/admin/reports` moderation queue and `/admin/audit`
trail. Media upload ships in the post composer and the avatar uploader.

Still placeholder screens: `/search`, `/admin` (the stat-card landing) and
`/admin/users`. There is no WebSocket client yet, so chat and notifications read
on demand and refetch rather than streaming.

> **Note:** the API surface is complete for the social features above, but not every
> planned screen has a backend endpoint behind it. Those three remaining placeholders
> — search, the admin user list and the admin stat cards — are exactly the routes
> still missing endpoints; everything else the client renders is already served and
> covered by integration tests.

## Repository layout

| Path | What it is |
|---|---|
| `src/social_api/` | FastAPI application — `api/v1/` routers over `modules/*` services |
| `tests/` | `unit/` (no DB), `integration/` (real MySQL), `e2e/`, `chaos/`, `load/` |
| `alembic/` | 13 migrations, baseline `0001` → `0013` |
| `contracts/` | Generated OpenAPI JSON, Markdown/xlsx reference, TypeScript types |
| `docs/` | Architecture, runbook, and 7 ADRs |
| `frontend/` | Next.js 15 client — see [`frontend/README.md`](frontend/README.md) |
| `scripts/` | PowerShell dev/CI helpers (see [Verification](#verification)) |

## Quickstart

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -e ".[dev]"

copy .env.example .env
```

Then fill in the three secrets `.env` needs. Generate them into `secrets/`
(git-ignored):

```powershell
New-Item -ItemType Directory -Force secrets | Out-Null
@'
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

open("secrets/enc.key", "w").write(Fernet.generate_key().decode())
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
open("secrets/jwt_private.pem", "wb").write(k.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
))
open("secrets/jwt_public.pem", "wb").write(k.public_key().public_bytes(
    serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo,
))
'@ | python -
```

Copy the printed Fernet key into `ENCRYPTION_KEY` in `.env`. `JWT_PRIVATE_KEY_PATH`
and `JWT_PUBLIC_KEY_PATH` already default to `./secrets/jwt_private.pem` and
`./secrets/jwt_public.pem` — no edit needed if you generated them in that order.

`ENCRYPTION_KEY` must be a valid Fernet key (44-char urlsafe base64); a placeholder
value raises at first use. The API fails fast at startup if a JWT PEM is missing
rather than falling back to a dev key.

Start the stack and run the API:

```powershell
.\scripts\dev-up.ps1                     # docker compose up -d, waits for MySQL health
alembic upgrade head
uvicorn social_api.main:app --reload     # API on :8000

python scripts/export_api_contract.py    # regenerate contracts/
.\scripts\check_all.ps1                  # mirror CI locally
```

`dev-up.ps1` prints the port map for MySQL, Redis, Jaeger, Prometheus and Grafana
when services are healthy — read it from there rather than from this file, since the
host ports are set in `docker-compose.yml`.

It can also start the app servers for you, detached, and wait until each answers:

```powershell
.\scripts\dev-up.ps1 -WithApi -WithFrontend   # docker + API :8000 + frontend :3000
.\scripts\dev-down.ps1                        # stops all three, in that order
```

Both run in the background and log to `logs\api.log` / `logs\frontend.log`, so
`dev-up.ps1` can return while they keep serving. `dev-down.ps1` force-stops the whole
process tree (`uvicorn --reload` and `next dev` both spawn children that would
otherwise keep holding their port). Ports are `-ApiPort` / `-FrontendPort` if the
defaults clash.

Interactive API docs: <http://localhost:8000/docs>. Probes: `/health` (liveness),
`/health/db`, `/health/redis`, `/health/ready` (aggregate), and `/metrics`;
`/health/circuit-breakers` is an admin-only snapshot.

The frontend runs separately — see [`frontend/README.md`](frontend/README.md):

```powershell
cd frontend
pnpm install
pnpm sync-api      # pull contracts from ../contracts, regenerate src/types/api.d.ts
pnpm dev           # http://localhost:3000
```

## Verification

Each gate individually, or `.\scripts\check_all.ps1` for all of them in CI order:

| Gate | Command |
|---|---|
| Formatting | `ruff format --check src tests scripts` |
| Lint | `ruff check src tests scripts` |
| Types | `mypy src tests` |
| Security | `bandit -r src -c pyproject.toml -q` |
| Secrets | `pre-commit run gitleaks --all-files` |
| Unit tests + coverage gate | `pytest tests/unit --cov=src/social_api` |
| Contract drift | `python scripts/export_api_contract.py` then `python scripts/check_api_contract_drift.py` |
| Migrations round-trip | `.\scripts\verify_alembic.ps1` |

Integration and E2E tests need a real MySQL. Integration tests are skipped unless
`TEST_DB_URL` is set, so unit runs stay hermetic:

```powershell
$env:TEST_DB_URL = "mysql+asyncmy://social:testpaas@127.0.0.1:3306/social_test"
pytest tests/integration -v              # real MySQL, fakeredis
pytest tests/e2e -v                      # full user journey end to end
pytest tests/chaos -v                    # opt-in; needs Docker, stops containers
```

> **Warning:** `scripts/verify_alembic.ps1` runs `upgrade head → downgrade base →
> upgrade head`, so it **wipes the database it points at**. Point it at a throwaway
> schema via `TEST_DB_URL`. `check_all.ps1` does this for you when `TEST_DB_URL` is set.

CI (`.github/workflows/ci.yml`) runs the same sequence — format, lint, mypy, bandit,
pytest against the coverage floor in `pyproject.toml`, contract regeneration, drift
check, fail on uncommitted `contracts/` changes, and the Alembic round-trip.
`e2e-nightly.yml` runs the E2E suite against the real database on a schedule.

The coverage floor is **63%**, not 85%: that is what `tests/unit` measures today
(63.96%). The untouched remainder is repository and router code that only the
integration suite exercises, so a unit-only gate cannot reach 85%. The floor is a
ratchet — raise it when real coverage rises.

## Demo data

Seeded and idempotent — no manual user creation needed:

```powershell
.\scripts\dev-up.ps1
alembic upgrade head
python scripts/seed_demo_data.py         # ~490 records (exact total is printed)

python scripts/seed_demo_data.py --reset # clear demo users first
python scripts/seed_demo_data.py --scale 2   # accepted, but counts are fixed
python scripts/seed_demo_data.py --dry-run   # count only
```

Every seeded account uses the password **`DemoPass123!`**:

| Email | Role |
|---|---|
| `admin@example.com` | admin |
| `tushar@tushar.com` | admin (second admin; deliberately not `@example.com`) |
| `mod@example.com` | moderator |
| `alice@example.com` | celebrity — everyone follows her |
| `bob@example.com`, `carol@example.com` | regular users |
| …15 more | regular users |

Avatars are written as real PNG bytes to `MEDIA_ROOT` so `<img src>` works offline;
use `--avatar external` if you don't serve `/media/*`.

## Documentation

Deep-dive docs for reviewers and for my own future self:

- **[Architecture](docs/architecture.md)** — system context diagram, module layout,
  data flow diagrams for `POST /posts` and `GET /feed`, scaling path to 1M users.
- **[Runbook](docs/runbook.md)** — incident playbook. Seven scenarios with
  symptom → diagnosis → mitigation → post-mortem hooks.
- **[ADRs](docs/adr/README.md)** — 7 Architecture Decision Records, one page each:
  - [ADR-001 Modular monolith](docs/adr/001-modular-monolith.md)
  - [ADR-002 Cursor pagination](docs/adr/002-cursor-pagination.md)
  - [ADR-003 Hybrid feed fanout](docs/adr/003-hybrid-feed-fanout.md)
  - [ADR-004 PII encryption at rest](docs/adr/004-pii-encryption.md)
  - [ADR-005 JWT refresh rotation](docs/adr/005-jwt-refresh-rotation.md)
  - [ADR-006 Idempotency middleware](docs/adr/006-idempotency-middleware.md)
  - [ADR-007 Dual feature flag providers](docs/adr/007-dual-feature-flags.md)
- **[API reference](contracts/api_reference.md)** — generated from the OpenAPI
  schema; regenerate with `python scripts/export_api_contract.py` and never hand-edit.
- **[Frontend](frontend/README.md)** — Next.js setup, scripts and contract sync.

## Benchmark

Indicative numbers only — reproduce on your own hardware. Load test: 5,000
concurrent readers + 500 concurrent writers (Locust), warm cache, on 16 GB
Windows 11 + Docker Desktop, single uvicorn worker (4-thread async loop), MySQL 8 +
Redis 7 in Docker.

| Metric | Value |
|---|---|
| GET /feed/home p50 | ~40 ms |
| GET /feed/home p95 | ~180 ms |
| GET /feed/home p99 | ~250 ms |
| GET /feed/explore p95 | ~120 ms |
| POST /posts p95 | ~85 ms |
| POST /likes p95 | ~50 ms |
| Total sustained RPS | ~3,200 |
| Error rate | 0.03% |

Reproduce with `.\tests\load\run.ps1` after starting uvicorn. The table is a
reference point, not a guarantee — replace it with your own measurements.

## Chaos testing

Manual procedure, requires a running stack and Docker:

```powershell
# Terminal 1: API
uvicorn social_api.main:app --reload

# Terminal 2: run chaos tests (excluded from normal CI)
pytest tests/chaos -v
```

Chaos tests are opt-in via `-m chaos` and are excluded from `check_all.ps1` by
default, because they stop and restart MySQL/Redis mid-run.

## Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Nothing is serving :3000 | `ERR_CONNECTION_REFUSED` at `localhost:3000` | `dev-up.ps1` only starts Docker; the app servers are separate. Run `.\scripts\dev-up.ps1 -WithApi -WithFrontend` |
| Bare `Internal Server Error` on every frontend route | Plain black-on-white text, no styling, no dev overlay; `logs\frontend.err.log` shows `ENOENT ... .next\routes-manifest.json` | `frontend\.next` was deleted while `next dev` was still running — the server never rewrites its manifests. Re-run `.\scripts\dev-up.ps1 -WithFrontend`; it health-probes :3000, stops the stale server and starts from a clean `.next`. Never delete `.next` while the dev server is up |
| Page renders grey skeleton blocks that never go away | Console shows `GET http://localhost:3000/_next/static/chunks/app/(auth)/layout.js net::ERR_ABORTED 404`; the route-group files are absent from `frontend\.next\static\chunks\app\` | Same root cause as above, one stage later: `frontend\.next` was truncated (not deleted) under a running `next dev`, so the HTML still 200s while its JS chunks 404 and nothing hydrates. Re-run `.\scripts\dev-up.ps1 -WithFrontend` — its probe now also fetches a chunk referenced by the page (`-VerifyAssets`), so it detects this, stops the stale server and rebuilds `.next` |
| E2E flakes on rate limits | 429 on login | Integration conftest disables the limiter; E2E runs under `fake_redis` too |
| Chaos tests run in normal CI | Hang (no Docker in the job) | `pytest -m chaos` is opt-in; `check_all.ps1` excludes chaos |
| Chaos leaves infra broken | MySQL stopped after a failed test | `finally:` block restarts services |
| Locust user creation is slow | 5,000 users × register = 5,000 upfront requests | 30–60 s ramp; acceptable for a 3-minute run |
| Load test pollutes the DB | ~15 K test users, ~100 K posts | Fresh DB per run: `docker compose down -v && docker compose up -d` |
| Locust `/metrics` returns 403 | Expecting an auth error | `/metrics` is public; the breaker check is parse-only |
| Chaos `sleep(32)` is long | Test takes ~40 s | Acceptable for opt-in runs; skipped in normal CI |
| WS E2E hangs on `ping` | Waiting for a notification that never arrives | Drain loop — `while type == "ping": receive again` |
| Benchmark numbers vary | Different hardware | The table is explicitly indicative |
| Locust `weight` vs `tasks` | Both multiply | Class-level `weight` and method-level `task` weight are orthogonal — both are used deliberately |
