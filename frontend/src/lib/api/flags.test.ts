import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { getFlags, setFlagOverride } from './flags';
import { IDEMPOTENCY_HEADER } from './idempotency';

/**
 * Admin feature flags — `src/social_api/api/v1/flags.py`.
 *
 * The module is two calls, but each carries a detail the UI silently depends on:
 *
 *  1. **The list is a bare envelope, not a page.** `GET /flags` returns
 *     `{ flags: [...] }` with no cursor and no filter, which is why the hook is a
 *     plain `useQuery`. A `cursor` appearing in the query string would mean this
 *     client invented one.
 *  2. **No `Idempotency-Key`.** The route is absent from the middleware's
 *     `_IDEMPOTENT_PATTERNS`, and the write is a state-set — repeating it lands on
 *     the same override. Sending a key would add a table write for nothing, so the
 *     absence is the assertion.
 *  3. **`enabled: null` must reach the wire as `null`.** It is the *clear*
 *     instruction, not "field omitted" — an `undefined` serialised away by
 *     `JSON.stringify` would leave the previous override in place while the UI
 *     reports success.
 *  4. **`action` is the only cleared/off discriminator.** Both come back as
 *     `enabled: false`, so the client must pass `action` through untouched rather
 *     than deriving it.
 *
 * Both endpoints are `require_roles(ADMIN)`, so a `403` is a normal signed-in
 * state here, not a fault.
 */

const LIST_PATH = '*/api/v1/flags';
const OVERRIDE_PATH = '*/api/v1/flags/:flag_name/override';

function errorBody(error: string, status: number, detail: unknown = 'test'): ApiErrorBody {
  return {
    error,
    status,
    detail,
    path: '/api/v1/flags',
    request_id: 'req-1',
  };
}

describe('getFlags', () => {
  it('unwraps the flag list and sends no cursor or filter', async () => {
    const captured: { method?: string; path?: string; search?: string } = {};
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const url = new URL(request.url);
        captured.method = request.method;
        captured.path = url.pathname;
        captured.search = url.search;
        return HttpResponse.json({
          flags: [
            { name: 'ws_enabled', env_value: true, builtin_value: true },
            { name: 'feed_fanout_enabled', env_value: false, builtin_value: true },
          ],
        });
      }),
    );

    const result = await getFlags();

    expect(captured.method).toBe('GET');
    expect(captured.path).toBe('/api/v1/flags');
    // No pagination on this endpoint: `FlagList` is `{ flags }`, not a page.
    expect(captured.search).toBe('');
    // Both values survive the round trip — the drift badge reads `env_value`
    // against `builtin_value`, so dropping either would silently hide it.
    expect(result.flags).toEqual([
      { name: 'ws_enabled', env_value: true, builtin_value: true },
      { name: 'feed_fanout_enabled', env_value: false, builtin_value: true },
    ]);
  });

  it('normalises a 403 into an AppApiError the screen can branch on', async () => {
    server.use(
      http.get(LIST_PATH, () => HttpResponse.json(errorBody('FORBIDDEN', 403), { status: 403 })),
    );

    const error = await getFlags().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('FORBIDDEN');
    // `FlagList` keys its "Admins only" state off exactly this: a client error,
    // not a transient one, so it must not invite a retry.
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });
});

describe('setFlagOverride', () => {
  it('posts the override to the flag path with no idempotency key', async () => {
    const captured: {
      method?: string;
      path?: string;
      key?: string | null;
      body?: unknown;
    } = {};
    server.use(
      http.post(OVERRIDE_PATH, async ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        captured.body = await request.json();
        return HttpResponse.json({
          flag: 'ws_enabled',
          user_id: 21,
          enabled: true,
          action: 'set',
        });
      }),
    );

    const result = await setFlagOverride('ws_enabled', { user_id: 21, enabled: true });

    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/api/v1/flags/ws_enabled/override');
    expect(captured.body).toEqual({ user_id: 21, enabled: true });
    // State-set semantics: the route is not in `_IDEMPOTENT_PATTERNS`, and a key
    // here would add a table write without changing the outcome.
    expect(captured.key).toBeNull();
    expect(result.action).toBe('set');
    expect(result.enabled).toBe(true);
  });

  it('sends enabled: null to clear, rather than omitting the field', async () => {
    let body: unknown;
    server.use(
      http.post(OVERRIDE_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          flag: 'email_enabled',
          user_id: 21,
          enabled: null,
          action: 'cleared',
        });
      }),
    );

    const result = await setFlagOverride('email_enabled', { user_id: 21, enabled: null });

    // `null` is the clear instruction. An absent key deserialises to the same
    // Python default (`None`) by accident, so the wire shape is pinned.
    expect(body).toEqual({ user_id: 21, enabled: null });
    expect(body).toHaveProperty('enabled', null);
    expect(result.enabled).toBeNull();
    expect(result.action).toBe('cleared');
  });

  it('passes the echoed action through untouched', async () => {
    // "cleared" and "set to off" both answer `enabled: false`; only `action`
    // separates them, and the success toast keys off it.
    server.use(
      http.post(OVERRIDE_PATH, () =>
        HttpResponse.json({
          flag: 'sms_enabled',
          user_id: 21,
          enabled: false,
          action: 'set',
        }),
      ),
    );

    const set = await setFlagOverride('sms_enabled', { user_id: 21, enabled: false });
    expect(set).toEqual({ flag: 'sms_enabled', user_id: 21, enabled: false, action: 'set' });
  });

  it('surfaces an unknown flag as a BAD_REQUEST carrying the known flags', async () => {
    server.use(
      http.post(OVERRIDE_PATH, () =>
        HttpResponse.json(
          errorBody('BAD_REQUEST', 400, { known_flags: ['ws_enabled', 'chat_enabled'] }),
          { status: 400 },
        ),
      ),
    );

    const error = await setFlagOverride('nope', { user_id: 21, enabled: true }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('BAD_REQUEST');
    // Unreachable from the select, which is built from `GET /flags` — but it is
    // the server's answer if the two ever disagree, and `detail` is machine data.
    expect(error.detail).toEqual({ known_flags: ['ws_enabled', 'chat_enabled'] });
  });

  it('rejects with an AppApiError when a non-admin writes', async () => {
    server.use(
      http.post(OVERRIDE_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403), { status: 403 }),
      ),
    );

    await expect(
      setFlagOverride('ws_enabled', { user_id: 21, enabled: true }),
    ).rejects.toBeInstanceOf(AppApiError);
  });
});
