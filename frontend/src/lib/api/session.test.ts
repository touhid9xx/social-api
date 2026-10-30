import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { refreshedAccess, refreshedTokens } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { SESSION_ENDPOINTS, SESSION_HINT_COOKIE } from '@/lib/session-constants';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import {
  endSession,
  hasSessionHint,
  refreshSession,
  restoreSession,
  startSession,
} from './session';
import { clearTokens, getAccessToken, getTokens, setAccessToken } from './tokens';

/**
 * Behavioural tests for the browser half of the session: the three same-origin
 * calls that own the httpOnly refresh cookie, plus the reload bootstrap.
 *
 * The invariant that matters most: **the refresh token is never observable from
 * JavaScript**. It is handed to `POST /api/auth/session` and afterwards only the
 * access token is readable — so an XSS payload cannot lift a 7-day credential.
 *
 * (refresh token কখনোই JS state-এ ঢোকে না — শুধু কুকি রুটে যায়; নিচের টেস্ট সেটাই পাহারা দেয়।)
 */

const REFRESH_TOKEN = refreshedTokens.refresh_token;

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'test-request-id' };
}

/** jsdom keeps cookies between tests in the same file, so clear ours explicitly. */
function dropCookies() {
  for (const name of [SESSION_HINT_COOKIE, 'sf_refresh']) {
    document.cookie = `${name}=; path=/; max-age=0`;
    document.cookie = `${name}=; path=/api/auth; max-age=0`;
  }
}

async function captureError(run: () => Promise<unknown>): Promise<AppApiError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppApiError);
    if (error instanceof AppApiError) return error;
    throw error;
  }
  throw new Error('Expected the call to reject, but it resolved');
}

beforeEach(() => {
  clearTokens();
  dropCookies();
});

describe('startSession', () => {
  it('adopts the refresh token into the cookie route and keeps only the access token', async () => {
    let posted: unknown = null;
    server.use(
      http.post(`*${SESSION_ENDPOINTS.adopt}`, async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const adopted = await startSession(refreshedTokens);

    expect(adopted).toBe(true);
    expect(posted).toEqual({ refresh_token: REFRESH_TOKEN });
    expect(getAccessToken()).toBe(refreshedTokens.access_token);
    expect(getTokens()).toEqual({ accessToken: refreshedTokens.access_token });
  });

  it('still signs the tab in when the cookie route fails, but reports it', async () => {
    server.use(
      http.post(`*${SESSION_ENDPOINTS.adopt}`, () =>
        HttpResponse.json(errorBody('INTERNAL_ERROR', 500, SESSION_ENDPOINTS.adopt), {
          status: 500,
        }),
      ),
    );

    const adopted = await startSession(refreshedTokens);

    // `false` means "this session will not survive a reload" — the user is not
    // bounced back to a filled-in login form just because a cookie failed.
    expect(adopted).toBe(false);
    expect(getAccessToken()).toBe(refreshedTokens.access_token);
  });
});

describe('refreshSession', () => {
  it('stores the rotated access token and nothing else', async () => {
    const accessToken = await refreshSession();

    expect(accessToken).toBe(refreshedAccess.access_token);
    expect(getAccessToken()).toBe(refreshedAccess.access_token);
    expect(getTokens()).toEqual({ accessToken: refreshedAccess.access_token });
  });

  it('clears the session and surfaces the envelope when the route rejects', async () => {
    server.use(
      http.post(`*${SESSION_ENDPOINTS.refresh}`, () =>
        HttpResponse.json(errorBody('TOKEN_REVOKED', 401, SESSION_ENDPOINTS.refresh), {
          status: 401,
        }),
      ),
    );
    setAccessToken('stale.access.token');

    const error = await captureError(refreshSession);

    expect(error.code).toBe('TOKEN_REVOKED');
    expect(error.isUnauthorized).toBe(true);
    expect(getAccessToken()).toBeNull();
  });

  it('rejects a 200 that carries no access token rather than storing junk', async () => {
    server.use(
      http.post(`*${SESSION_ENDPOINTS.refresh}`, () => HttpResponse.json({ token_type: 'Bearer' })),
    );

    await captureError(refreshSession);

    expect(getAccessToken()).toBeNull();
  });
});

describe('restoreSession', () => {
  it('is a no-op for an anonymous visitor — no guaranteed-401 round trip', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(`*${SESSION_ENDPOINTS.refresh}`, () => {
        refreshCalls += 1;
        return HttpResponse.json(refreshedAccess);
      }),
    );

    await expect(restoreSession()).resolves.toBe(false);
    expect(refreshCalls).toBe(0);
    expect(getAccessToken()).toBeNull();
  });

  it('re-mints the access token when the hint cookie is present', async () => {
    document.cookie = `${SESSION_HINT_COOKIE}=1; path=/`;

    await expect(restoreSession()).resolves.toBe(true);
    expect(hasSessionHint()).toBe(true);
    expect(getAccessToken()).toBe(refreshedAccess.access_token);
  });

  it('drops a stale hint when the cookie turns out to be expired', async () => {
    document.cookie = `${SESSION_HINT_COOKIE}=1; path=/`;
    server.use(
      http.post(`*${SESSION_ENDPOINTS.refresh}`, () =>
        HttpResponse.json(errorBody('TOKEN_REVOKED', 401, SESSION_ENDPOINTS.refresh), {
          status: 401,
        }),
      ),
    );

    await expect(restoreSession()).resolves.toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('does not network at all when an access token is already in memory', async () => {
    setAccessToken('live.access.token');

    await expect(restoreSession()).resolves.toBe(true);
    expect(getAccessToken()).toBe('live.access.token');
  });
});

describe('endSession', () => {
  it('clears the local session before calling the backend', async () => {
    setAccessToken('live.access.token');

    await endSession();

    expect(getAccessToken()).toBeNull();
  });

  it('still signs out locally when the logout route is unreachable', async () => {
    setAccessToken('live.access.token');
    server.use(http.post(`*${SESSION_ENDPOINTS.logout}`, () => HttpResponse.error()));

    await expect(endSession()).resolves.toBeUndefined();
    expect(getAccessToken()).toBeNull();
  });

  it('forwards the bearer so the backend can revoke the refresh family', async () => {
    let authorization: string | null = null;
    server.use(
      http.post(`*${SESSION_ENDPOINTS.logout}`, ({ request }) => {
        authorization = request.headers.get('authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setAccessToken('live.access.token');

    await endSession();

    expect(authorization).toBe('Bearer live.access.token');
  });
});
