import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { adminUser } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { changePassword, getAuthMe } from './auth';
import { AppApiError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';
import { clearTokens, setAccessToken } from './tokens';

/**
 * The authenticated half of the auth API — `src/social_api/modules/auth/router.py`.
 *
 * Only two calls live in `./auth`, but each one answers a question the rest of
 * the app gets wrong if it makes the call itself:
 *
 *  1. **`GET /auth/me` is the only source of the caller's own `role`.** The
 *     obvious-looking alternative, `GET /users/me`, returns `ProfileSelf` — the
 *     owner's PII and *no* `role` field — so a `role` read from there is a type
 *     error, not a runtime surprise. The staff entry in `UserMenu` branches on
 *     this call, and `admin` vs `moderator` reach different routes.
 *  2. **A 401 from `change-password` is an answer, not an expired session.** The
 *     route re-checks `current_password`, so `INVALID_CREDENTIALS` means "you
 *     typed the wrong password". `./client.ts` lists the path in
 *     `NO_RETRY_PATHS`; refreshing there would burn a rotation and replace the
 *     real message with a sign-out.
 *
 * (নিজের role শুধু `GET /auth/me` থেকেই আসে — `/users/me`-এ `role` ফিল্ডই নেই।)
 */

const ME_PATH = '*/api/v1/auth/me';
const CHANGE_PASSWORD_PATH = '*/api/v1/auth/change-password';

/** Counts hits on the same-origin refresh route the client would use on a 401. */
let refreshCalls = 0;

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'test-request-id' };
}

beforeEach(() => {
  clearTokens();
  refreshCalls = 0;
  // Stubbed on every test so a stray refresh would land here and be counted,
  // instead of escaping to the shared mock or to the network.
  server.use(
    http.post('*/api/auth/refresh', () => {
      refreshCalls += 1;
      return HttpResponse.json({ access_token: 'refreshed.access.token' });
    }),
  );
});

describe('getAuthMe', () => {
  it('reads the caller identity from /auth/me, not /users/me', async () => {
    const captured: {
      method?: string;
      path?: string;
      search?: string;
      auth?: string | null;
    } = {};
    server.use(
      http.get(ME_PATH, ({ request }) => {
        const url = new URL(request.url);
        captured.method = request.method;
        captured.path = url.pathname;
        captured.search = url.search;
        captured.auth = request.headers.get('authorization');
        return HttpResponse.json(adminUser);
      }),
    );
    setAccessToken('test.access.token');

    const me = await getAuthMe();

    expect(captured.method).toBe('GET');
    expect(captured.path).toBe('/api/v1/auth/me');
    // No pagination and no filter: `UserPublic` is a single object.
    expect(captured.search).toBe('');
    // The bearer token is the whole point — this read is about *me*.
    expect(captured.auth).toBe('Bearer test.access.token');
    expect(me).toEqual(adminUser);
  });

  it('passes the role through untouched for every non-admin value', async () => {
    // The client must not narrow the union here: `UserMenu` decides which staff
    // route to offer, and a moderator sent to the admin-only root would 403.
    server.use(
      http.get(ME_PATH, () => HttpResponse.json({ ...adminUser, id: 7, role: 'moderator' })),
    );

    const me = await getAuthMe();

    expect(me.role).toBe('moderator');
    expect(me.id).toBe(7);
    // `UserPublic` is sanitised server-side — no email, no display name. Pinned
    // because the tempting "fix" for a missing name is to swap in `/users/me`
    // and lose `role` in the process.
    expect(me).not.toHaveProperty('email');
    expect(me).not.toHaveProperty('display_name');
  });

  it('normalises a 401 into an AppApiError', async () => {
    server.use(
      http.get(ME_PATH, () =>
        HttpResponse.json(errorBody('UNAUTHORIZED', 401, '/api/v1/auth/me'), { status: 401 }),
      ),
    );

    const error = await getAuthMe().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.status).toBe(401);
  });
});

describe('changePassword', () => {
  it('posts snake_case credentials with no idempotency key', async () => {
    const captured: {
      method?: string;
      path?: string;
      key?: string | null;
      body?: unknown;
    } = {};
    server.use(
      http.post(CHANGE_PASSWORD_PATH, async ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        captured.body = await request.json();
        return HttpResponse.json({ message: 'Password updated' });
      }),
    );

    const result = await changePassword({
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword2@',
    });

    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/api/v1/auth/change-password');
    // The wire contract is snake_case (`ChangePasswordRequest`); the camelCase
    // form state stops at this boundary. Sending the wrong key is a 422, and a
    // 422 here reads to the user as "your password is invalid".
    expect(captured.body).toEqual({
      current_password: 'OldPassword1!',
      new_password: 'NewPassword2@',
    });
    // Not in the middleware's `_IDEMPOTENT_PATTERNS`: the route blacklists the
    // caller's token, so a replay could never be a benign repeat anyway.
    expect(captured.key).toBeNull();
    expect(result.message).toBe('Password updated');
  });

  it('surfaces a wrong current password without attempting a refresh', async () => {
    // A token is present so the 401 *would* take the refresh path if the path
    // were not in `NO_RETRY_PATHS` — the absence of a refresh call is the
    // assertion, not an accident of a missing session.
    setAccessToken('still.valid.access.token');
    server.use(
      http.post(CHANGE_PASSWORD_PATH, () =>
        HttpResponse.json(errorBody('INVALID_CREDENTIALS', 401, '/api/v1/auth/change-password'), {
          status: 401,
        }),
      ),
    );

    const error = await changePassword({
      currentPassword: 'definitely-wrong',
      newPassword: 'NewPassword2@',
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.status).toBe(401);
    // Refresh-and-replay would rotate the token and sign the user out, turning
    // "wrong password" into "your session expired".
    expect(refreshCalls).toBe(0);
  });
});
