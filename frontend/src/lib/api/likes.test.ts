import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';
import { LIKE_TARGET_TYPES, type LikeUserPage, getLikers, likeTarget, unlikeTarget } from './likes';

/**
 * Like / unlike.
 *
 * Both endpoints answer `204 No Content`, so the surface here is narrow and
 * worth pinning exactly: the path segments, the fact that `POST` carries an
 * `Idempotency-Key` and `DELETE` does not, and that a 204 is not mistaken for an
 * error (no body means nothing to parse).
 *
 * (204-এ body নেই — তাই কোনো parse ভুল করলে সেটা এখানেই ধরা পড়বে।)
 */

const LIKES_PATH = '*/api/v1/likes/:target_type/:target_id';

function errorBody(error: string, status: number): ApiErrorBody {
  return { error, status, detail: 'test', path: '/api/v1/likes/post/101', request_id: 'req-1' };
}

describe('likeTarget types', () => {
  it('accepts only the target types the backend accepts', () => {
    // `likes/router.py` rejects anything outside this set with BAD_REQUEST.
    expect([...LIKE_TARGET_TYPES]).toEqual(['post', 'comment']);
  });
});

describe('likeTarget', () => {
  it('posts to the target path and returns void', async () => {
    const captured: { method?: string; path?: string; key?: string | null } = {};
    server.use(
      http.post(LIKES_PATH, ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(likeTarget('post', 101)).resolves.toBeUndefined();

    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/api/v1/likes/post/101');
    // The like endpoints sit behind the idempotency middleware, so a retried
    // POST must be recognised as the same intent.
    expect(captured.key).toMatch(/^[\w-]{8,128}$/);
  });

  it('supports comment targets', async () => {
    const captured: { path?: string } = {};
    server.use(
      http.post(LIKES_PATH, ({ request }) => {
        captured.path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await likeTarget('comment', 55);

    expect(captured.path).toBe('/api/v1/likes/comment/55');
  });

  it('normalises a backend error envelope into an AppApiError', async () => {
    server.use(
      http.post(LIKES_PATH, () =>
        HttpResponse.json(errorBody('LIKE_TARGET_NOT_FOUND', 404), { status: 404 }),
      ),
    );

    const error = await likeTarget('post', 999).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('LIKE_TARGET_NOT_FOUND');
    expect(error.isClientError).toBe(true);
  });
});

describe('unlikeTarget', () => {
  it('deletes the target path and sends no idempotency key', async () => {
    const captured: { method?: string; path?: string; key?: string | null } = {};
    server.use(
      http.delete(LIKES_PATH, ({ request }) => {
        captured.method = request.method;
        captured.path = new URL(request.url).pathname;
        captured.key = request.headers.get(IDEMPOTENCY_HEADER);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await unlikeTarget('post', 101);

    expect(captured.method).toBe('DELETE');
    expect(captured.path).toBe('/api/v1/likes/post/101');
    // DELETE is already idempotent at the HTTP layer; a key would add nothing.
    expect(captured.key).toBeNull();
  });

  it('rejects with an AppApiError when the API fails', async () => {
    server.use(
      http.delete(LIKES_PATH, () =>
        HttpResponse.json(errorBody('SERVICE_UNAVAILABLE', 503), { status: 503 }),
      ),
    );

    await expect(unlikeTarget('post', 101)).rejects.toBeInstanceOf(AppApiError);
  });
});

/**
 * `GET /likes/{target_type}/{target_id}/users` — the read side of a like.
 *
 * Two behaviours belong to the client and are pinned here: the first page must
 * not send a cursor at all (`null` is not "the first page" on the wire — it is a
 * literal the backend would try to decode), and the returned `next_cursor` must
 * come back untouched so the caller can echo it.
 *
 * The fixture's third liker has `display_name: null` on purpose: the backend
 * copies the name straight off the profile and never invents a fallback
 * (`likes/service.py:116-122`), so the envelope must be handed over as-is and
 * the naming decision left to the UI. A client-side "fix" here would be a
 * second source of truth.
 */

const LIKERS_PATH = '*/api/v1/likes/:target_type/:target_id/users';

describe('getLikers', () => {
  it('requests the target path with the default page size and no cursor', async () => {
    const captured: { url?: URL } = {};
    server.use(
      http.get(LIKERS_PATH, ({ request }) => {
        captured.url = new URL(request.url);
        const empty: LikeUserPage = { items: [], next_cursor: null };
        return HttpResponse.json(empty);
      }),
    );

    await getLikers('post', 101);

    expect(captured.url?.pathname).toBe('/api/v1/likes/post/101/users');
    expect(captured.url?.searchParams.get('limit')).toBe(String(DEFAULT_PAGE_SIZE));
    expect(captured.url?.searchParams.has('cursor')).toBe(false);
  });

  it('passes an opaque cursor through untouched', async () => {
    const captured: { url?: URL } = {};
    server.use(
      http.get(LIKERS_PATH, ({ request }) => {
        captured.url = new URL(request.url);
        const empty: LikeUserPage = { items: [], next_cursor: null };
        return HttpResponse.json(empty);
      }),
    );

    await getLikers('comment', 55, { cursor: 'likers-page-2', limit: 5 });

    expect(captured.url?.pathname).toBe('/api/v1/likes/comment/55/users');
    expect(captured.url?.searchParams.get('cursor')).toBe('likers-page-2');
    expect(captured.url?.searchParams.get('limit')).toBe('5');
  });

  it('returns the page envelope verbatim, including an absent display name', async () => {
    const first = await getLikers('post', 101);

    expect(first.items.map((u) => u.user_id)).toEqual([22, 23, 24]);
    expect(first.next_cursor).toBe('likers-page-2');
    // Never defaulted, never renamed: the dialog owns the fallback copy.
    expect(first.items[2]?.display_name).toBeNull();

    const second = await getLikers('post', 101, { cursor: 'likers-page-2' });

    expect(second.items.map((u) => u.user_id)).toEqual([25]);
    expect(second.next_cursor).toBeNull();
  });

  it('surfaces a malformed cursor as a client error', async () => {
    server.use(
      http.get(LIKERS_PATH, () =>
        HttpResponse.json(errorBody('INVALID_CURSOR', 400), { status: 400 }),
      ),
    );

    const error = await getLikers('post', 101, { cursor: 'nonsense' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('INVALID_CURSOR');
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });
});
