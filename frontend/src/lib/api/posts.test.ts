import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';
import { createPost, type PostCreateBody } from './posts';

/**
 * `POST /api/v1/posts`.
 *
 * The one behaviour that is not obvious from the signature: every create
 * carries a FRESH `Idempotency-Key`, because a double submit or a network retry
 * must resolve to the first post rather than publishing a duplicate. Two
 * submits are two intents, so the keys must differ.
 *
 * (একই key দুবার পাঠালে সার্ভার প্রথম পোস্টটাই ফেরত দিত — তাই প্রতি submit-এ নতুন key।)
 */

const POSTS_PATH = '*/api/v1/posts';

function errorBody(error: string, status: number): ApiErrorBody {
  return { error, status, detail: 'test', path: '/api/v1/posts', request_id: 'req-1' };
}

function capture() {
  const seen: { body?: PostCreateBody; key?: string | null } = {};
  server.use(
    http.post(POSTS_PATH, async ({ request }) => {
      seen.body = (await request.json()) as PostCreateBody;
      seen.key = request.headers.get(IDEMPOTENCY_HEADER);
      return HttpResponse.json({}, { status: 201 });
    }),
  );
  return seen;
}

describe('createPost', () => {
  it('sends the body and returns the created post', async () => {
    const response = await createPost({ body: 'Hello feed', visibility: 'followers' });

    // The default mock handler answers with a contract-shaped PostView.
    expect(response.body).toBe('Hello feed');
    expect(response.visibility).toBe('followers');
    expect(response.id).toBeGreaterThanOrEqual(900);
  });

  it('creates an idempotency key and sends it as a header', async () => {
    const seen = capture();

    await createPost({ body: 'Key check', visibility: 'public' });

    expect(seen.body?.body).toBe('Key check');
    // The middleware enforces 8..128 characters.
    expect(seen.key).toMatch(/^[\w-]{8,128}$/);
  });

  it('uses a different key for each submission', async () => {
    const keys: Array<string | null> = [];
    server.use(
      http.post(POSTS_PATH, ({ request }) => {
        keys.push(request.headers.get(IDEMPOTENCY_HEADER));
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await createPost({ body: 'First', visibility: 'public' });
    await createPost({ body: 'Second', visibility: 'public' });

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('normalises a validation failure into an AppApiError', async () => {
    server.use(
      http.post(POSTS_PATH, () =>
        HttpResponse.json(errorBody('VALIDATION_ERROR', 422), { status: 422 }),
      ),
    );

    const error = await createPost({ body: ' ', visibility: 'public' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.isClientError).toBe(true);
  });
});
