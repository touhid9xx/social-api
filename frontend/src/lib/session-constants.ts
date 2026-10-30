/**
 * Session contract shared by the browser and the Next route handlers.
 *
 * The refresh token NEVER reaches JavaScript: it lives in the httpOnly
 * `sf_refresh` cookie, which is only ever sent back to `/api/auth/*`. The
 * browser holds a short-lived access token in memory (see `./api/tokens.ts`)
 * and re-mints it through `/api/auth/refresh` on reload.
 *
 * (এই ফাইলটা শুধু কনস্ট্যান্ট — সার্ভার আর ক্লায়েন্ট দু'পাশেই ইমপোর্ট হয়,
 *  তাই এখানে কোনো DOM বা next/server ইমপোর্ট থাকা যাবে না।)
 */

/** httpOnly, path-scoped to the auth routes — never readable by JS. */
export const REFRESH_COOKIE = 'sf_refresh';

/**
 * Readable companion cookie. It carries no credential, only the fact that a
 * refresh cookie exists, so the client knows whether a reload is worth a
 * refresh round trip. Without it every anonymous page load would fire a
 * pointless 401.
 */
export const SESSION_HINT_COOKIE = 'sf_session';

/** The refresh cookie is only sent to the route handlers that need it. */
export const AUTH_COOKIE_PATH = '/api/auth';

/** The hint must be visible from every page, hence the root path. */
export const SESSION_HINT_PATH = '/';

/**
 * Mirrors the backend default `jwt_refresh_ttl_seconds` (604800 = 7 days).
 * The browser copy is not authoritative — the backend still rejects an
 * expired token — it only stops the cookie lingering past its usefulness.
 */
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 604_800;

/**
 * Same-origin endpoints served by `src/app/api/auth/*`. These are NOT backend
 * paths: they run in the Next server, hold the refresh cookie, and proxy the
 * exchange to `POST /api/v1/auth/refresh`.
 */
export const SESSION_ENDPOINTS = {
  /** Store the refresh token handed back by a successful login. */
  adopt: '/api/auth/session',
  /** Exchange the cookie for a fresh access token (also rotates the cookie). */
  refresh: '/api/auth/refresh',
  /** Revoke server-side and drop both cookies. */
  logout: '/api/auth/logout',
} as const;

export type SessionEndpoint = (typeof SESSION_ENDPOINTS)[keyof typeof SESSION_ENDPOINTS];
