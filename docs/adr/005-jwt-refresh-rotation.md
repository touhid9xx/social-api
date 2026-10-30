

## Context

Stateless auth via JWT is standard. But long-lived refresh tokens are
a known attack surface:

- **Stolen refresh** → attacker mints new tokens indefinitely.
- **No revocation** → compromised account cannot be locked out without
  a shared secret change (breaks all users).

Two common patterns:

1. **Static refresh tokens** (single-use long-lived) — one refresh token
   lives for 7 days; used many times.
2. **Rotating refresh tokens** — every refresh issues a new refresh and
   blacklists the old one.

## Decision

**Rotate.** Every `POST /auth/refresh` issues a new access + refresh
pair; the old refresh's JTI is blacklisted in Redis with TTL = its
remaining lifetime.

- Access: RS256, 15m TTL, stateless.
- Refresh: RS256, 7d TTL, rotates.
- Blacklist: `jwt:blacklist:{jti}` in Redis, TTL = `exp - now`.
- Logout blacklists both access and refresh JTIs.

## Consequences

**Positive:**
- **Stolen refresh one-shot**: if attacker uses it, the next legitimate
  refresh fails with `TOKEN_REVOKED`. Attacker has at most one use
  (short window).
- **Session tracking**: every refresh produces a fresh JTI, so
  "sessions" can be enumerated (future feature: "log out all other
  sessions").
- **Logout is real**: JTI blacklist means an issued token cannot be
  used until it expires — critical for stolen-laptop scenarios.

**Negative:**
- **Redis dependency for auth**: blacklist check is a Redis GET. If
  Redis is down, `get_current_user` needs a decision: fail-closed
  (reject all) or fail-open (accept all). We choose **fail-open**
  (M22 decision): a Redis outage shouldn't block all users. Trade-off:
  a stolen token could be used for its remaining TTL during the outage.
  Mitigation: short access TTL (15m).
- **Refresh concurrency**: two tabs both refresh at the same time.
  One succeeds; the other gets `TOKEN_REVOKED`. Mitigation: client
  must handle — refresh immediately on 401, or use a background timer
  with jitter. Documented in contracts/README.md.
- **Blacklist size**: proportional to active refreshes (7d retention).
  At 1M users × 1 active session = 1M keys × ~40 bytes = 40MB. Fine.

**Alternative rejected:** static refresh. Simpler, but no revocation,
and a stolen refresh is permanent until expiry.

**Alternative rejected:** short-lived everything + no refresh. Forces
users to log in frequently — bad UX. And no way to keep an active
session for 7 days without a refresh mechanism.

## Implementation notes

- `core/security.py::issue_access_token`, `issue_refresh_token`,
  `decode_token(expected_type=...)`.
- `RefreshRequest` on `/auth/refresh` verifies JTI not blacklisted
  **before** issuing new pair. On success: `blacklist_jti(old_jti,
  ttl=remaining)`, return new pair.
- Logout: same flow + also blacklists refresh if provided.
- Custom exceptions: `InvalidTokenError`, `TokenRevokedError`.
- Test suite (M4) covers roundtrip, expiry, wrong type, tampered,
  rotation, revocation.
