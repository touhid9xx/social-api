# Architecture Decision Records

Lightweight, sequential records of architecturally significant decisions
made during the build.

**Convention:** ADR-NNN-title.md. Each is immutable once accepted.
If a decision is reversed, write a new ADR that supersedes it (marked
"Supersedes ADR-NNN").

| # | Title | Status |
|---|---|---|
| 001 | [Modular monolith over microservices](001-modular-monolith.md) | Accepted |
| 002 | [Cursor pagination over offset](002-cursor-pagination.md) | Accepted |
| 003 | [Hybrid feed fanout](003-hybrid-feed-fanout.md) | Accepted |
| 004 | [PII encryption at rest via Fernet TypeDecorator](004-pii-encryption.md) | Accepted |
| 005 | [JWT refresh token rotation with JTI blacklist](005-jwt-refresh-rotation.md) | Accepted |
| 006 | [Idempotency at HTTP middleware](006-idempotency-middleware.md) | Accepted |
| 007 | [Dual feature flag providers (sync env + async chained)](007-dual-feature-flags.md) | Accepted |
