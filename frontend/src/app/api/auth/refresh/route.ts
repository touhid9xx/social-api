import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { AuthTokens } from '@/lib/api/tokens';
import {
  backendUrl,
  clearAuthCookies,
  errorEnvelope,
  isSecureRequest,
  sessionExpiredResponse,
  setRefreshCookie,
} from '@/lib/server/session';
import { REFRESH_COOKIE, SESSION_ENDPOINTS } from '@/lib/session-constants';

/**
 * `POST /api/auth/refresh` — the only place the refresh token is used.
 *
 * Reads the httpOnly cookie, exchanges it with the backend, rotates the cookie
 * and returns just `{ access_token, expires_in, token_type }`. The refresh
 * token is never part of this response, so a page reload can re-establish the
 * session without the credential ever entering JavaScript.
 *
 * (পেজ রিলোডে সেশন থাকে — কারণ refresh token শুধু httpOnly কুকিতে, ক্লায়েন্টে নয়।)
 */

export const dynamic = 'force-dynamic';

type AccessTokenPayload = Omit<AuthTokens, 'refresh_token'>;

type Outcome = { ok: true; tokens: AuthTokens } | { ok: false; status: number; body: unknown };

/**
 * Concurrent refreshes from two tabs would both present the SAME cookie value,
 * and the backend rotates + blacklists the old JTI
 * (docs/adr/005-jwt-refresh-rotation.md) — the loser would be signed out.
 * Collapsing them per token value makes the race impossible inside one server
 * process, which is the common case behind a single Node instance.
 */
const inFlight = new Map<string, Promise<Outcome>>();

function isAuthTokens(value: unknown): value is AuthTokens {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof AuthTokens, unknown>>;
  return (
    typeof candidate.access_token === 'string' &&
    candidate.access_token.length > 0 &&
    typeof candidate.refresh_token === 'string' &&
    candidate.refresh_token.length > 0
  );
}

async function exchange(refreshToken: string): Promise<Outcome> {
  let upstream: Response;

  try {
    upstream = await fetch(backendUrl('/api/v1/auth/refresh'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 503,
      body: errorEnvelope(
        'SERVICE_UNAVAILABLE',
        503,
        SESSION_ENDPOINTS.refresh,
        'The API could not be reached',
      ),
    };
  }

  let payload: unknown = null;
  try {
    payload = await upstream.json();
  } catch {
    payload = null;
  }

  if (!upstream.ok) return { ok: false, status: upstream.status, body: payload };

  if (!isAuthTokens(payload)) {
    return {
      ok: false,
      status: 502,
      body: errorEnvelope(
        'UNEXPECTED_ERROR',
        502,
        SESSION_ENDPOINTS.refresh,
        'The API returned an unexpected token payload',
      ),
    };
  }

  return { ok: true, tokens: payload };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secure = isSecureRequest(request);
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) return sessionExpiredResponse(secure);

  let pending = inFlight.get(refreshToken);
  if (!pending) {
    pending = exchange(refreshToken).finally(() => {
      inFlight.delete(refreshToken);
    });
    inFlight.set(refreshToken, pending);
  }

  const outcome = await pending;

  if (!outcome.ok) {
    const response = NextResponse.json(
      outcome.body ??
        errorEnvelope(
          'UNAUTHORIZED',
          outcome.status,
          SESSION_ENDPOINTS.refresh,
          'No active session',
        ),
      { status: outcome.status },
    );
    // The cookie is dead (rotated away, expired or revoked) — drop it so the
    // next reload does not retry a token that can never work.
    clearAuthCookies(response, secure);
    return response;
  }

  const body: AccessTokenPayload = {
    access_token: outcome.tokens.access_token,
    expires_in: outcome.tokens.expires_in,
    token_type: outcome.tokens.token_type,
  };

  const response = NextResponse.json(body);
  setRefreshCookie(response, outcome.tokens.refresh_token, secure);
  return response;
}
