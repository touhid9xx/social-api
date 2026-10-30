# ADR-001: Modular monolith over microservices

**Status:** Accepted

## Context

The backend needs to support 1M users and encompass 12+ feature domains
(auth, users, follows, posts, comments, likes, feed, notifications,
chat, presence, moderation, audit, GDPR). A common industry default is
"microservices from day one."

We have a single backend developer and a fixed hardware budget
(16 GB laptop for local dev, single VPS for demo deploy).

## Decision

Build as a **modular monolith**: one FastAPI application, one Docker
image, internal modules with strict boundaries enforced by convention
+ tests.

Boundaries to preserve:
- Each `modules/<name>/` may depend on other modules' **services** and
  **schemas**, never on their **routers** or **repositories**.
- Cross-module writes go through service layer only.
- Circular imports between `modules/` are forbidden.

## Consequences

**Positive:**
- Zero network latency for internal calls — feed assembly, notification
  fanout, etc. are function calls.
- One deploy artifact → simple rollback, simple ops.
- Single transaction boundary — the outbox pattern is unnecessary for
  our scope (DB write + audit write commit together).
- Debugging = tail one log stream.

**Negative:**
- One process → one memory ceiling. At ~5K RPS we'll need to scale
  horizontally (stateless API behind nginx — supported).
- A bug in any module can crash the whole app.
- Deploying any module means deploying all.

**Mitigations:**
- Stateless API → horizontal scaling works without code changes.
- Module boundaries enforced by convention + review (future: import-linter).
- Fast CI (unit + e2e in < 60s) means deploys are cheap.

## When to extract services

Only when a module's scaling profile diverges from the app's:
- **Feed fanout** when queue depth consistently exceeds target latency.
- **Chat/WebSocket** when connection count per app instance becomes
  the limiting factor.
- **Media** if serving it from the app ever happens (currently
  nginx/S3, so unlikely).

Until then, monolith — with modular discipline — is strictly better.
