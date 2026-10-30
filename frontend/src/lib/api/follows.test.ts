import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { followCounts, followersOf22, followStatus, followingOf22 } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import {
  followUser,
  getFollowers,
  getFollowCounts,
  getFollowing,
  getFollowStatus,
  unfollowUser,
} from './follows';
import { IDEMPOTENCY_HEADER } from './idempotency';

/**
 * The follow-graph client.
 *
 * Four things are not visible from the signatures and are pinned here:
 *
 *  - `follow-status` is viewer-relative, and an unknown target must be the same
 *    404 the profile endpoint answers — the status endpoint must never invent a
 *    user the profile denies;
 *  - zero followers is a real 200 answer, not an error;
 *  - the first page sends NO cursor (a `null` would arrive as the literal string
 *    "null") and an opaque cursor round-trips untouched;
 *  - `POST` carries an `Idempotency-Key` and `DELETE` does not, and a 204 is not
 *    mistaken for a failure because there is no body to parse.
 *
 * (অজানা ইউজার মিথ্যা প্রোফাইল পায় না; প্রথম পাতায় cursor যায় না; 204 মানেই সফল।)
 */

const COUNTS_PATH = '*/api/v1/users/:user_id/follow-counts';
const FOLLOWERS_PATH = '*/api/v1/users/:user_id/followers';
const FOLLOWING_PATH = '*/api/v1/users/:user_id/following';
const FOLLOW_PATH = '*/api/v1/follows/:user_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getFollowStatus', () => {
  it('answers for the target, viewer-relative', async () => {
    const status = await getFollowStatus(23);

    // The whole object matters: the screen reads `is_following` for the button
    // and both block flags to decide whether to draw it at all.
    expect(status).toEqual(followStatus[23]);
    expect(status.is_following).toBe(true);
  });

  it('404s an unknown target exactly like the profile endpoint', async () => {
    const error = await getFollowStatus(999_999).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('PROFILE_NOT_FOUND');
    expect(error.isClientError).toBe(true);
  });
});

describe('getFollowCounts', () => {
  it('returns the public totals for the target', async () => {
    const counts = await getFollowCounts(22);

    expect(counts).toEqual(followCounts[22]);
  });

  it('treats zero as an answer rather than an error', async () => {
    // User 24 genuinely has no followers: the header links "0" to a real page.
    await expect(getFollowCounts(24)).resolves.toEqual({ followers: 0, following: 0 });
  });

  it('normalises a failure into an AppApiError', async () => {
    server.use(
      http.get(COUNTS_PATH, () =>
        HttpResponse.json(errorBody('INTERNAL_ERROR', 500, '/api/v1/users/22/follow-counts'), {
          status: 500,
        }),
      ),
    );

    const error = await getFollowCounts(22).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('getFollowers', () => {
  it('omits the cursor on the first page and sends the limit', async () => {
    let search = '';
    server.use(
      http.get(FOLLOWERS_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getFollowers(22, { limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded to the backend as the string "null".
    expect(params.has('cursor')).toBe(false);
  });

  it('round-trips an opaque cursor and keeps the rows in order', async () => {
    // Driven by the real paginating mock handler, so this proves the client
    // hands back exactly the string it was given — it never parses it.
    const first = await getFollowers(22, { limit: 2 });
    expect(first.items.map((row) => row.user_id)).toEqual([21, 23]);
    expect(first.next_cursor).toBe('2');

    const second = await getFollowers(22, { cursor: first.next_cursor, limit: 2 });
    expect(second.items.map((row) => row.user_id)).toEqual([24]);
    expect(second.next_cursor).toBeNull();
  });

  it('passes an opaque cursor through verbatim', async () => {
    let cursor: string | null = null;
    server.use(
      http.get(FOLLOWERS_PATH, ({ request }) => {
        cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getFollowers(22, { cursor: 'eyJvZmZzZXQiOjJ9', limit: 2 });

    expect(cursor).toBe('eyJvZmZzZXQiOjJ9');
  });
});

describe('getFollowing', () => {
  it('reads the other end of the graph, not the follower list', async () => {
    let pathname = '';
    server.use(
      http.get(FOLLOWING_PATH, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getFollowing(22);

    expect(pathname).toBe('/api/v1/users/22/following');
  });

  it('serves the seeded following list from the shared fixture', async () => {
    const page = await getFollowing(22);

    expect(page.items.map((row) => row.user_id)).toEqual(followingOf22.map((row) => row.user_id));
  });
});

describe('followUser', () => {
  it('posts to the target and resolves on a 204 with no body', async () => {
    const captured: { method?: string; path?: string; key?: string | null } = {};
    server.use(
      http.post(FOLLOW_PATH, ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(followUser(22)).resolves.toBeUndefined();

    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/api/v1/follows/22');
    // The write sits behind the idempotency middleware, so a retried POST must
    // be recognised as the same intent rather than a second follow.
    expect(captured.key).toMatch(/^[\w-]{8,128}$/);
  });

  it('is repeatable: a second follow resolves the same way', async () => {
    await expect(followUser(22)).resolves.toBeUndefined();
    await expect(followUser(22)).resolves.toBeUndefined();
  });

  it('normalises a rejected follow into an AppApiError', async () => {
    server.use(
      http.post(FOLLOW_PATH, () =>
        HttpResponse.json(errorBody('PROFILE_NOT_FOUND', 404, '/api/v1/follows/999999'), {
          status: 404,
        }),
      ),
    );

    const error = await followUser(999_999).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('PROFILE_NOT_FOUND');
  });
});

describe('unfollowUser', () => {
  it('deletes the relationship and sends no idempotency key', async () => {
    const captured: { method?: string; path?: string; key?: string | null } = {};
    server.use(
      http.delete(FOLLOW_PATH, ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(unfollowUser(22)).resolves.toBeUndefined();

    expect(captured.method).toBe('DELETE');
    expect(captured.path).toBe('/api/v1/follows/22');
    // DELETE is already idempotent at the HTTP layer; a key would add nothing.
    expect(captured.key).toBeNull();
  });

  it('rejects with an AppApiError when the API fails', async () => {
    server.use(
      http.delete(FOLLOW_PATH, () =>
        HttpResponse.json(errorBody('SERVICE_UNAVAILABLE', 503, '/api/v1/follows/22'), {
          status: 503,
        }),
      ),
    );

    await expect(unfollowUser(22)).rejects.toBeInstanceOf(AppApiError);
  });
});

// Dead-code guard: the fixtures only earn their keep if the shared handlers
// actually serve them, or these tests would pass against a mock nobody uses.
describe('handler wiring', () => {
  it('serves the seeded follower rows in order', async () => {
    const page = await getFollowers(22, { limit: 100 });

    expect(page.items.map((row) => row.user_id)).toEqual(followersOf22.map((row) => row.user_id));
    expect(page.next_cursor).toBeNull();
  });

  it('gives a user with no seeded graph an empty page, not a 404', async () => {
    await expect(getFollowers(23)).resolves.toEqual({ items: [], next_cursor: null });
  });

  it('404s the status of a user nobody seeded', async () => {
    await expect(getFollowStatus(404_404)).rejects.toBeInstanceOf(AppApiError);
  });
});
