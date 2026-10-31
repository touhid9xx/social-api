import createClient, { type Middleware } from 'openapi-fetch';

import { apiBaseUrl } from '@/lib/env';
import type { paths } from '@/types/api';

import { SESSION_ENDPOINTS } from '../session-constants';

import { AppApiError, isApiErrorBody, isAppApiError, toAppApiError } from './errors';
import { refreshSession } from './session';
import { getAccessToken } from './tokens';

/**
 * Contract-typed HTTP client. Every path, query string and body below is
 * checked against `src/types/api.d.ts`, which is generated from the backend
 * OpenAPI document — so a backend signature change breaks `pnpm type-check`
 * here instead of failing at runtime.
 *
 * Verified against contracts/api_reference.md:
 *   POST /api/v1/auth/login     (:121)  body `LoginRequest` -> `{ user, tokens }` (nested)
 *   GET  /api/v1/users/me       (:2376) -> `ProfileSelf`
 *   GET  /api/v1/feed/home      (:1019) `cursor` + `limit` (1..50) -> `HomeFeedPage`
 *
 * `/api/v1/auth/refresh` is deliberately NOT called from here: the refresh
 * token lives in an httpOnly cookie, so the exchange happens in the Next route
 * handler `src/app/api/auth/refresh/route.ts` (see `./session.ts`).
 */

/**
 * Endpoints that mint or consume credentials. A 401 from these means the
 * credentials are wrong, not that the access token expired — refreshing would
 * be pointless and, for `/auth/login`, would loop forever.
 */
const NO_RETRY_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/verify-email',
  // Changing a password re-checks `current_password`, so a 401 here means
  // "wrong current password" (`INVALID_CREDENTIALS`), not an expired session.
  // A refresh + replay would burn a token rotation and hide the real error.
  '/api/v1/auth/change-password',
]);

/**
 * Late-bound `fetch`.
 *
 * openapi-fetch resolves `fetch` once, when the client is created. Passing
 * `globalThis.fetch` directly would therefore capture whatever existed at
 * module-evaluation time — under Vitest that is Node's native undici fetch,
 * which talks to the real network and sails straight past MSW's interceptor.
 * Wrapping it in a closure defers the lookup to call time, so the app and the
 * tests both observe the same, current `fetch`.
 */
const dynamicFetch: typeof fetch = (...args) => globalThis.fetch(...args);

let inFlightRefresh: Promise<string> | null = null;

/**
 * Re-mint the access token from the httpOnly refresh cookie.
 *
 * Single-flight: N concurrent 401s trigger exactly ONE call. The backend
 * rotates the refresh token and blacklists the old JTI
 * (docs/adr/005-jwt-refresh-rotation.md), so parallel refreshes would revoke
 * each other and sign the user out.
 *
 * The token itself never passes through here — `refreshSession` talks to the
 * same-origin route handler, which owns the cookie
 * (`src/app/api/auth/refresh/route.ts`).
 */
export function refreshAccessToken(): Promise<string> {
  // Clear the slot on SETTLE, not from inside the body: it can reject before
  // its first `await`, in which case a `finally` inside would run *before*
  // this assignment and cache a dead rejected promise forever.
  if (!inFlightRefresh) {
    inFlightRefresh = runRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function runRefresh(): Promise<string> {
  try {
    return await refreshSession();
  } catch (error) {
    // `refreshSession` has already dropped the in-memory token (the session is
    // genuinely dead: cookie gone, expired or revoked); just normalize the throw
    // so the caller sees an `AppApiError`.
    throw toAppApiError(error, SESSION_ENDPOINTS.refresh);
  }
}

/**
 * Requests cloned as they leave, so a 401 can be replayed with a fresh token.
 * `Request.clone()` throws once the body has been read, so the copy is taken
 * in `onRequest` rather than after the response arrives.
 */
const pristineRequests = new WeakMap<Request, Request>();

function pathnameOf(url: string): string {
  try {
    return new URL(url, apiBaseUrl).pathname;
  } catch {
    return url;
  }
}

/**
 * Turn an openapi-fetch failure into an `AppApiError`.
 *
 * openapi-fetch reads the body itself (`await response.text()` + `JSON.parse`)
 * to populate `error`, so the Response we get back has an already-consumed
 * body: calling `response.json()` here throws `body used already` and would
 * downgrade every real envelope to UNEXPECTED_ERROR. Use the parsed value, and
 * fall back to the raw Response only when the body was not our envelope
 * (proxy HTML, plain text, empty).
 */
function toErrorFromResult(error: unknown, response: Response, path: string): AppApiError {
  if (isAppApiError(error)) return error;
  if (isApiErrorBody(error)) return new AppApiError(error);
  return toAppApiError(response, path);
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    pristineRequests.set(request, request.clone());

    const accessToken = getAccessToken();
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
  },

  async onResponse({ request, response }) {
    if (response.status !== 401) return;
    if (NO_RETRY_PATHS.has(pathnameOf(request.url))) return;

    let accessToken: string;
    try {
      accessToken = await refreshAccessToken();
    } catch {
      // Refresh failed; `runRefresh` already cleared the session. Hand the
      // original 401 back so the caller surfaces "please sign in again".
      return;
    }

    const original = pristineRequests.get(request);
    if (!original) return;

    const retried = original.clone();
    retried.headers.set('Authorization', `Bearer ${accessToken}`);

    try {
      return await dynamicFetch(retried);
    } catch {
      return;
    }
  },
};

/** The app-wide client. Import this; do not build another one. */
export const apiClient = createClient<paths>({
  baseUrl: apiBaseUrl,
  // The backend sets no cookies at all; omitting them keeps the CORS
  // preflight simpler and guarantees no ambient credential is ever sent.
  credentials: 'omit',
  headers: { Accept: 'application/json' },
  fetch: dynamicFetch,
});

apiClient.use(authMiddleware);

type OperationResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Unwrap an openapi-fetch result into a value or a thrown `AppApiError`.
 *
 * TanStack Query wants thrown errors (that is what `retry` and `onError`
 * receive), and `useQuery` cannot express a union return without making every
 * call site check for `error`. So: throw here, once.
 */
export async function apiRequest<T>(run: () => Promise<OperationResult<T>>): Promise<T> {
  let result: OperationResult<T>;

  try {
    result = await run();
  } catch (error) {
    throw toAppApiError(error);
  }

  const { data, error, response } = result;

  if (response.ok) {
    // 204 No Content legitimately yields `undefined`; callers type it as `void`.
    return data as T;
  }

  throw toErrorFromResult(error, response, pathnameOf(response.url));
}

/** True when the failure means "the session is gone", not "this call failed". */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof AppApiError && error.isUnauthorized;
}
