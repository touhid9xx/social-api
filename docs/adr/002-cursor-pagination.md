# ADR-002: Cursor pagination over offset

**Status:** Accepted

## Context

List endpoints (feed, posts by author, comments, notifications, chat
messages, followers/following, audit, moderation) all need pagination.
Two standard options:

1. **Offset/limit**: `?page=3&limit=20` → `LIMIT 20 OFFSET 40`.
2. **Cursor**: opaque token encoding `(sort_key, tie_breaker)` → `WHERE (sort_key, tie_breaker) < (cursor_key, cursor_id) LIMIT 21`.

## Decision

**Cursor everywhere.** Every list endpoint uses cursor pagination via
`core.pagination.encode_cursor` / `decode_cursor`.

Cursor format: `base64url(json({k: [sort_val, id]})) . hmac_sha256[:16]`.

- **Sort key**: `created_at` (or score for explore) DESC.
- **Tie-breaker**: `id` DESC (identical timestamps resolved deterministically).
- **Signature**: HMAC keyed by `ENCRYPTION_KEY`, truncated to 16 bytes.
  Prevents client tampering (e.g., skipping visibility rules — though
  authz is always re-enforced server-side, this stops trivial
  malformed-cursor probing).

## Consequences

**Positive:**
- **O(1) offset**: `OFFSET 10000` requires scanning 10K rows; cursor
  scan starts at the key. Critical at scale — feed and notifications
  regularly exceed page 10.
- **Stable under insertion**: new rows don't shift page boundaries
  mid-scroll (offset pagination can show duplicates or skip items when
  new rows appear between requests).
- **Tamper-resistant**: HMAC signature prevents forged cursors.
- **Opaque**: no client can construct a cursor for a sort order we
  haven't designed for; changing sort order is a client-visible but
  controlled migration.

**Negative:**
- **No random access**: cannot jump to page N. Must traverse.
- **Cursor invalid after schema change** — if sort key changes, all
  outstanding cursors break. Mitigation: version cursors (future).
- **Slightly larger URL** — ~60-100 chars vs `page=3`. Acceptable.

**Alternative rejected:** keyset pagination without signature. Same
performance; loses the "client can't forge" property. At our scale the
added property (defense in depth) is worth the small amount of extra
code.

## Implementation notes

- `clamp_limit` caps `limit` at 100 globally (some endpoints to 50).
- Every module's cursor decoder wraps `PaginationError` in
  `BadRequestError` → 400 with `detail: {code: "INVALID_CURSOR"}`.
- No `OFFSET` in the entire codebase (grep `OFFSET` returns 0 hits
  except in `tests/` for verification).
