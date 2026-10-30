import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { adminProfile, DEMO_ADMIN_EMAIL, refreshedAccess, refreshedTokens } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { apiClient, apiRequest, isSessionExpired } from './client';
import { AppApiError } from './errors';
import { clearTokens, getAccessToken, getTokens, setAccessToken } from './tokens';

/**
 * Behavioural tests for the auth-aware client. The three things that can quietly
 * destroy a session in production, all pinned here:
 *
 *  1. A 401 must refresh ONCE for N concurrent requests. The backend rotates and
 *     blacklists the refresh JTI (docs/adr/005-jwt-refresh-rotation.md), so
 *     parallel refreshes revoke each other and sign the user out.
 *  2. A 401 from `/auth/login` must NEVER refresh — the credentials are wrong,
 *     not expired; refreshing would loop forever.
 *  3. A failed refresh must clear the session so the UI can route to /login.
 *
 * The refresh itself goes through the same-origin route handler
 * (`POST /api/auth/refresh`), which owns the httpOnly cookie — so the mock here
 * returns the access token only.
 *
 * (একসাথে ৩টা 401 এলে refresh একবারই হবে — নইলে token rotation একে অপরকে বাতিল করবে।)
 */

const EXPIRED_ACCESS_TOKEN = 'expired.access.token';

let refreshCalls = 0;

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'test-request-id' };
}

/** `/users/me` that only accepts the POST-refresh access token. */
function protectedProfile() {
  return http.get('*/api/v1/users/me', ({ request }) =>
    request.headers.get('authorization') === `Bearer ${refreshedTokens.access_token}`
      ? HttpResponse.json(adminProfile)
      : HttpResponse.json(errorBody('UNAUTHORIZED', 401, '/api/v1/users/me'), { status: 401 }),
  );
}

async function captureError(run: () => Promise<unknown>): Promise<AppApiError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppApiError);
    if (error instanceof AppApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to reject, but it resolved');
}

beforeEach(() => {
  clearTokens();
  refreshCalls = 0;
  server.use(
    http.post('*/api/auth/refresh', () => {
      refreshCalls += 1;
      return HttpResponse.json(refreshedAccess);
    }),
  );
});

describe('apiRequest', () => {
  it('returns the unwrapped body on success', async () => {
    const profile = await apiRequest(() => apiClient.GET('/api/v1/users/me'));

    expect(profile.user_id).toBe(adminProfile.user_id);
    expect(profile.display_name).toBe('Admin');
  });

  it('resolves to undefined for a 204 with no body', async () => {
    const result = await apiRequest(() => apiClient.POST('/api/v1/auth/logout'));

    expect(result).toBeUndefined();
  });

  it('throws an AppApiError built from the backend envelope, never a raw Response', async () => {
    server.use(
      http.get('*/api/v1/users/me', () =>
        HttpResponse.json(errorBody('UNAUTHORIZED', 401, '/api/v1/users/me'), { status: 401 }),
      ),
    );

    const error = await captureError(() => apiRequest(() => apiClient.GET('/api/v1/users/me')));

    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.status).toBe(401);
    expect(error.path).toBe('/api/v1/users/me');
    expect(error.requestId).toBe('test-request-id');
    expect(error.isUnauthorized).toBe(true);
  });
});

describe('refresh is never attempted on credential routes', () => {
  it('does not refresh after a 401 from /auth/login', async () => {
    setAccessToken(EXPIRED_ACCESS_TOKEN);

    const error = await captureError(() =>
      apiRequest(() =>
        apiClient.POST('/api/v1/auth/login', {
          body: { email: DEMO_ADMIN_EMAIL, password: 'definitely-wrong' },
        }),
      ),
    );

    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.status).toBe(401);
    expect(error.requestId).toBe('test-request-id');
    expect(refreshCalls).toBe(0);
  });
});

describe('single-flight refresh', () => {
  it('refreshes exactly once for concurrent 401s and replays each request', async () => {
    server.use(protectedProfile());
    setAccessToken(EXPIRED_ACCESS_TOKEN);

    const profiles = await Promise.all([
      apiRequest(() => apiClient.GET('/api/v1/users/me')),
      apiRequest(() => apiClient.GET('/api/v1/users/me')),
      apiRequest(() => apiClient.GET('/api/v1/users/me')),
    ]);

    expect(refreshCalls).toBe(1);
    expect(profiles).toHaveLength(3);
    for (const profile of profiles) expect(profile.user_id).toBe(adminProfile.user_id);
  });

  it('stores the rotated access token after refreshing', async () => {
    server.use(protectedProfile());
    setAccessToken(EXPIRED_ACCESS_TOKEN);

    await apiRequest(() => apiClient.GET('/api/v1/users/me'));

    // The rotated refresh token never reaches JS: the route handler keeps it
    // in the httpOnly cookie, so only the access token is observable here.
    expect(getAccessToken()).toBe(refreshedTokens.access_token);
    expect(getTokens()).toEqual({ accessToken: refreshedTokens.access_token });
  });

  it('does not refresh on a 500, which is not an auth failure', async () => {
    server.use(
      http.get('*/api/v1/users/me', () =>
        HttpResponse.json(errorBody('INTERNAL_ERROR', 500, '/api/v1/users/me'), { status: 500 }),
      ),
    );
    setAccessToken(EXPIRED_ACCESS_TOKEN);

    const error = await captureError(() => apiRequest(() => apiClient.GET('/api/v1/users/me')));

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.isTransient).toBe(true);
    expect(refreshCalls).toBe(0);
  });
});

describe('failed refresh', () => {
  it('clears the session and surfaces the original 401', async () => {
    server.use(
      protectedProfile(),
      // The app never calls the backend refresh path directly: the same-origin
      // route handler owns the cookie, so that is the call that must fail.
      http.post('*/api/auth/refresh', () =>
        HttpResponse.json(errorBody('TOKEN_REVOKED', 401, '/api/auth/refresh'), { status: 401 }),
      ),
    );
    setAccessToken(EXPIRED_ACCESS_TOKEN);

    const error = await captureError(() => apiRequest(() => apiClient.GET('/api/v1/users/me')));

    expect(error.status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(getTokens()).toBeNull();
  });
});

describe('isSessionExpired', () => {
  it('is true only for a 401 AppApiError', () => {
    expect(isSessionExpired(new AppApiError(errorBody('UNAUTHORIZED', 401, '/x')))).toBe(true);
    expect(isSessionExpired(new AppApiError(errorBody('FORBIDDEN', 403, '/x')))).toBe(false);
    expect(isSessionExpired(new Error('boom'))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});
