import { NextResponse } from 'next/server';

import { apiBaseUrl } from '@/lib/env';
import {
  AUTH_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  SESSION_ENDPOINTS,
  SESSION_HINT_COOKIE,
  SESSION_HINT_PATH,
} from '@/lib/session-constants';

import type { ApiErrorBody } from '@/types';

/**
 * Server-only helpers for the auth route handlers. Runs in the Next server
 * (Node runtime), never in the browser bundle — `next/server` and the
 * `NEXT_PUBLIC_API_URL` backend origin are used directly.
 *
 * (এই ফাইলটা শুধু route handler থেকে ইমপোর্ট হবে; ক্লায়েন্ট বান্ডলে ঢোকা যাবে না।)
 */

/**
 * `secure` cookies are dropped by the browser over plain http, which would
 * silently break `next start` on http://localhost. Derive it from the actual
 * request instead of `NODE_ENV`, and honour the proxy header when present.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The backend error envelope produced by `social_api/exceptions.py`. */
export function errorEnvelope(
  error: string,
  status: number,
  path: string,
  detail: string,
): ApiErrorBody {
  return { error, status, detail, path, request_id: null };
}

export function setRefreshCookie(response: NextResponse, token: string, secure: boolean): void {
  response.cookies.set({
    name: REFRESH_COOKIE,
    value: token,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: AUTH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });

  // Companion flag only — intentionally NOT httpOnly so the client can read it.
  response.cookies.set({
    name: SESSION_HINT_COOKIE,
    value: '1',
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: SESSION_HINT_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookies(response: NextResponse, secure: boolean): void {
  response.cookies.set({
    name: REFRESH_COOKIE,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: AUTH_COOKIE_PATH,
    maxAge: 0,
  });
  response.cookies.set({
    name: SESSION_HINT_COOKIE,
    value: '',
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: SESSION_HINT_PATH,
    maxAge: 0,
  });
}

/** 401 in the exact envelope shape the client already knows how to map. */
export function sessionExpiredResponse(secure: boolean): NextResponse {
  const response = NextResponse.json(
    errorEnvelope('UNAUTHORIZED', 401, SESSION_ENDPOINTS.refresh, 'No active session'),
    { status: 401 },
  );
  clearAuthCookies(response, secure);
  return response;
}

/**
 * Absolute backend origin — the route handlers talk to the API server-side.
 *
 * `NEXT_PUBLIC_API_URL` is inlined at build time and must stay browser-safe, so
 * it cannot also address the API from inside a container: there, `localhost` is
 * the frontend container itself (see docker-compose.prod.yml), not nginx.
 * `API_INTERNAL_URL` is a non-public variable, so Next reads it at runtime; set
 * it to the in-network origin. Unset outside Docker, which leaves host
 * development pointed at `NEXT_PUBLIC_API_URL` exactly as before.
 */
export function backendUrl(path: string): string {
  const internal = process.env.API_INTERNAL_URL?.replace(/\/+$/, '');
  return `${internal || apiBaseUrl}${path}`;
}

/** Headers forwarded so backend i18n picks the same language the user reads. */
export function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const language = request.headers.get('accept-language');
  if (language) headers['accept-language'] = language;

  return headers;
}
