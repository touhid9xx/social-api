import type { components } from '@/types/api';

import { SESSION_ENDPOINTS, SESSION_HINT_COOKIE } from '../session-constants';

import { AppApiError, isApiErrorBody, toAppApiError } from './errors';
import { clearTokens, getAccessToken, setAccessToken, type AuthTokens } from './tokens';

/**
 * Browser side of the session: the three same-origin calls that own the
 * httpOnly refresh cookie, plus the reload bootstrap.
 *
 * Deliberately plain `fetch` rather than `openapi-fetch`: these endpoints are
 * Next route handlers, not backend operations, so they are absent from the
 * OpenAPI document. Their request/response BODIES are still contract types
 * (`LoginResponse`, `AuthTokens`) — only the path typing is local.
 *
 * (backend contract টাইপ অপরিবর্তিত; শুধু সম-অরিজিন route গুলো এখানে হাত দিয়ে টাইপ করা।)
 */

export type SessionUser = components['schemas']['UserPublic'];

/** The refresh response deliberately omits `refresh_token`. */
export type AccessTokenPayload = Omit<AuthTokens, 'refresh_token'>;

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { access_token?: unknown };
  return typeof candidate.access_token === 'string' && candidate.access_token.length > 0;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }

  return null;
}

/**
 * True when the browser is holding a (non-httpOnly) hint that an httpOnly
 * refresh cookie exists. It grants nothing — it only saves anonymous visitors
 * a guaranteed-401 round trip on every page load.
 */
export function hasSessionHint(): boolean {
  return readCookie(SESSION_HINT_COOKIE) === '1';
}

async function parse(response: Response, path: string): Promise<unknown> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) return payload;

  // Our route handlers forward the backend envelope verbatim, so the same
  // catalogue mapping applies (`errorMessageKey`).
  if (isApiErrorBody(payload)) throw new AppApiError(payload);
  throw toAppApiError(response, path);
}

async function post(path: string, body?: unknown, headers?: HeadersInit): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
}

/**
 * Adopt the refresh token from a login response into the httpOnly cookie.
 * Exposed separately so callers can tell whether the reload path is durable.
 */
export async function adoptSession(refreshToken: string): Promise<void> {
  const response = await post(SESSION_ENDPOINTS.adopt, { refresh_token: refreshToken });
  await parse(response, SESSION_ENDPOINTS.adopt);
}

/**
 * The only two fields of an `AuthTokens` envelope this layer reads. Widening the
 * parameter to them keeps both sources of the contract type compatible: the
 * generated `src/types/api.d.ts` (used by `openapi-fetch`) and the exported
 * `contracts/types.ts` (used by fixtures).
 */
type SessionSeed = {
  access_token: string;
  refresh_token: string;
};

/**
 * Sign in for this tab. The access token is stored first so a failure to set
 * the cookie (offline, API hiccup) still leaves the user usable until reload.
 */
export async function startSession(tokens: SessionSeed): Promise<boolean> {
  setAccessToken(tokens.access_token);

  try {
    await adoptSession(tokens.refresh_token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exchange the httpOnly cookie for a fresh access token.
 *
 * Any failure — 401 `TOKEN_REVOKED`, a 500, an offline network — means the
 * session can no longer be trusted, so the in-memory access token is dropped
 * here rather than in each caller. One place clears, every caller can rely on
 * it, and no caller is left holding a token the server already rejected.
 */
export async function refreshSession(): Promise<string> {
  try {
    const response = await post(SESSION_ENDPOINTS.refresh);
    const payload = await parse(response, SESSION_ENDPOINTS.refresh);

    if (!isAccessTokenPayload(payload)) {
      throw toAppApiError(null, SESSION_ENDPOINTS.refresh);
    }

    setAccessToken(payload.access_token);
    return payload.access_token;
  } catch (error) {
    clearTokens();
    throw toAppApiError(error, SESSION_ENDPOINTS.refresh);
  }
}

/** Revoke server-side (best effort) and drop the local session. */
export async function endSession(): Promise<void> {
  const accessToken = getAccessToken();
  clearTokens();

  try {
    await post(
      SESSION_ENDPOINTS.logout,
      undefined,
      accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    );
  } catch {
    // The route handler clears the cookies whenever it is reached; if the
    // network is down there is nothing further to do locally.
  }
}

/**
 * Reload bootstrap: restore the in-memory session if the browser has one.
 * Returns `true` when an access token is in place afterwards.
 */
export async function restoreSession(): Promise<boolean> {
  if (getAccessToken()) return true;
  if (!hasSessionHint()) return false;

  try {
    await refreshSession();
    return true;
  } catch {
    clearTokens();
    return false;
  }
}
