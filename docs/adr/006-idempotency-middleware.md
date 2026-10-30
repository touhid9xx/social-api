# ADR-006: Idempotency at HTTP middleware

**Status:** Accepted

## Context

Client retries are inevitable (network glitches, mobile backgrounding,
user double-tap). For non-idempotent writes (POST), a retry can create
duplicates: "I posted this twice!"

Three layers we could implement idempotency at:

1. **Database unique constraint** on natural key (e.g., `(author_id,
   created_at_second)` on posts) — brittle, doesn't handle all cases,
   doesn't work for uploads.
2. **Per-route logic** — every endpoint implements its own
   "check-then-insert" with a client key. N× duplicated code.
3. **HTTP middleware** — check `Idempotency-Key` header, cache the
   response, replay on retry.

## Decision

**HTTP middleware.** Client sends `Idempotency-Key: <uuid-v4>` on
idempotent-worthy POST routes. Server:

1. `INSERT (key, user_id, endpoint, request_hash, expires_at=now+24h)`
   — atomic via unique constraint.
2. Run the handler.
3. Store `(response_status, response_body)` on the row.
4. On retry: same key + same body hash → return stored response
   with header `Idempotent-Replay: true`.
5. Same key + different body → 409 `IDEMPOTENCY_KEY_CONFLICT`.
6. Concurrent requests → 409 `IDEMPOTENCY_IN_PROGRESS` (client retries).

Routes covered: `POST /posts`, `/posts/{id}/comments`, `/likes/*`,
`/follows/*`, `/media`, `/chat/rooms/{id}/messages`,
`/moderation/reports`. Extendable by adding to `_IDEMPOTENT_PATTERNS`.

Storage: MySQL `idempotency_keys` table (not Redis — survives Redis
outage, matches our "MySQL is source of truth" principle for critical
data).

## Consequences

**Positive:**
- **Zero route changes**: routes stay clean; middleware is transparent.
- **Extensible**: add a route to a regex list.
- **DB-backed** — survives Redis restart. Same guarantees as a data
  write.
- **Uniform behaviour**: every idempotent endpoint responds to retries
  identically.

**Negative:**
- **Client must send the key**. Existing clients that don't → no
  idempotency (backward compatible, but no benefit).
- **Response bodies buffered**: middleware reads response body to
  store it. Adds memory for large responses. Our idempotent routes
  return small JSON — fine. Would need streaming response handling
  if we ever add a large-response idempotent endpoint.
- **In-progress returns 409**: retries during the original request
  get 409, not a wait-then-replay. Clients must handle: retry on 409
  after 1s. Documented in contracts/README.md.
- **24h TTL may be too short** for some workflows. Env-configurable
  (`IDEMPOTENCY_TTL_SECONDS`); 24h is industry-standard (Stripe uses
  24h).

**Alternative rejected:** per-route `@idempotent` decorator. More
explicit but requires touching every route. Middleware-level is
opt-in by path, and captures all methods uniformly.

**Alternative rejected:** Redis-only storage. Faster, but loses
idempotency keys on Redis restart — defeats the point. DB-backed is
the correct choice for critical data.

## Related

- M22 implementation details: `modules/idempotency/middleware.py`.
- Two concurrency edge cases documented inline.
- Test: `tests/integration/test_idempotency_api.py`.
