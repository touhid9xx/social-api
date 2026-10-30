import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';
import { LIKE_TARGET_TYPES, likeTarget, unlikeTarget } from './likes';

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
