import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { adminDirectory } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { getAdminUsers } from './users';

/**
 * The staff-only directory client — `GET /api/v1/users`.
 *
 * Three contract facts are pinned, and they are the ones the console cannot
 * recover from if they drift:
 *
 *  - the first page sends NO cursor, and an opaque one round-trips untouched;
 *  - the page size travels as `limit`, defaulting to `DEFAULT_PAGE_SIZE`;
 *  - `403 FORBIDDEN` is a *normal* answer here. The frontend cannot pre-check the
 *    caller's role (the role arrives with the token and the server stays the
 *    authority), so the refusal has to settle into an `AppApiError` in one
 *    request — never a retry storm, never a crash.
 *
 * The rows deliberately carry `display_name` and `avatar_url` themselves, which
 * is why `UserList` must not fan out to `/users/{id}` per row. That rule is
 * asserted where it can actually break: `user-list.test.tsx`.
 *
 * (প্রথম পাতায় cursor যায় না; 403 একটি স্বাভাবিক উত্তর, তাই একবারেই থামে।)
 */

const USERS_PATH = '*/api/v1/users';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getAdminUsers', () => {
  it('returns the directory page from the shared fixture', async () => {
    const page = await getAdminUsers();

    expect(page.items.map((user) => user.id)).toEqual(adminDirectory.items.map((user) => user.id));
    // Three rows is the whole directory, so the backend reports no next page.
    expect(page.next_cursor).toBeNull();
  });

  it('asks for the first page without a cursor and with the default size', async () => {
    let search = '';
    server.use(
      http.get(USERS_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getAdminUsers();

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe(String(DEFAULT_PAGE_SIZE));
    // The client defaults `cursor` to `null`; forwarding that literal would send
    // the string "null" and the backend would reject it as an invalid cursor.
    expect(params.has('cursor')).toBe(false);
  });

  it('passes an opaque cursor back verbatim alongside the page size', async () => {
    const page = await getAdminUsers({ cursor: '1', limit: 1 });

    // The fixture holds three rows, so starting at offset 1 must skip the first.
    expect(page.items.map((user) => user.id)).toEqual(
      adminDirectory.items.slice(1, 2).map((user) => user.id),
    );
    expect(page.next_cursor).toBe('2');
  });

  it('sends only the two parameters the endpoint accepts', async () => {
    let search = '';
    server.use(
      http.get(USERS_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getAdminUsers({ cursor: '2', limit: 5 });

    // The route declares no filter at all, so a stray parameter would be a
    // caller inventing a contract that does not exist.
    expect([...new URLSearchParams(search).keys()].sort()).toEqual(['cursor', 'limit']);
  });

  it('normalises an admin-only refusal into a non-transient AppApiError', async () => {
    server.use(
      http.get(USERS_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/users'), { status: 403 }),
      ),
    );

    const error = await getAdminUsers().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('FORBIDDEN');
    expect(error.status).toBe(403);
    expect(error.path).toBe('/api/v1/users');
    // `query-provider.tsx` skips 4xx, and the screen renders this as
    // "admins only" — so it must be a client error, not something worth retrying.
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });
});
