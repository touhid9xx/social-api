/**
 * `Idempotency-Key` support — [docs/adr/006-idempotency-middleware.md].
 *
 * The backend caches responses for repeatable writes (`POST /posts`,
 * `POST /likes/…`, comments, follows, media, reports) keyed by this header, so a
 * double-tap or a network retry replays the first response instead of creating a
 * second post. The middleware only engages when the header is present, and it
 * rejects keys outside 8..128 characters with `INVALID_IDEMPOTENCY_KEY`.
 *
 * One key per *user intent*, not per attempt: that is the whole point. Generate
 * it once when the user submits, and let the request (and the client's own
 * 401-refresh replay, which reuses the same headers) carry it.
 *
 * The key is not a secret and is scoped per (key, user_id) in MySQL, so a weak
 * fallback generator is acceptable — losing `crypto.randomUUID` (insecure
 * contexts, old browsers) degrades collision resistance, not security.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Backend bounds: `_MIN_KEY_LEN`..`_MAX_KEY_LEN` in the middleware. */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function idempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;

  const random = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  return `idem-${Date.now().toString(36)}-${random}`;
}
