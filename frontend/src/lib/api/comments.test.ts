import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { type CommentCreateBody, createComment, getPostComments } from './comments';
import { AppApiError } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';

/**
 * `GET|POST /api/v1/posts/{post_id}/comments`.
 *
 * Three things are not obvious from the signatures and are pinned here:
 *  - the first page sends NO cursor (a `null` would be a literal cursor to a
 *    backend that decodes it), and a returned cursor round-trips untouched;
 *  - a create carries a FRESH `Idempotency-Key`, so a retried submit resolves to
 *    the first comment instead of posting twice;
 *  - a 422 becomes an `AppApiError`, never a raw envelope.
 *
 * (প্রথম পাতায় cursor যায় না; আর প্রতিটি submit-এ নতুন idempotency key।)
 */

const COMMENTS_PATH = '*/api/v1/posts/:post_id/comments';

function errorBody(error: string, status: number): ApiErrorBody {
  return {
    error,
    status,
    detail: 'test',
    path: '/api/v1/posts/101/comments',
    request_id: 'req-1',
  };
}

describe('getPostComments', () => {
  it('requests the post thread and returns the page', async () => {
    const page = await getPostComments(101);

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.post_id).toBe(101);
  });

  it('omits the cursor on the first page and sends the limit', async () => {
    let search = '';
    server.use(
      http.get(COMMENTS_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getPostComments(101, { limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded as the string "null".
    expect(params.has('cursor')).toBe(false);
  });

  it('passes an opaque cursor back verbatim', async () => {
    let cursor: string | null = null;
    server.use(
      http.get(COMMENTS_PATH, ({ request }) => {
        cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    // The cursor is opaque: this test never parses it, it only proves the client
    // does not either.
    await getPostComments(101, { cursor: 'eyJvZmZzZXQiOjIwfQ', limit: 2 });

    expect(cursor).toBe('eyJvZmZzZXQiOjIwfQ');
  });
});

describe('createComment', () => {
  it('posts the body and returns the created comment', async () => {
    const created = await createComment(101, { body: 'Hello thread' });

    expect(created.body).toBe('Hello thread');
    expect(created.post_id).toBe(101);
    // Ids from the mock start above the fixture range.
    expect(created.id).toBeGreaterThanOrEqual(950);
    expect(created.depth).toBe(0);
  });

  it('sends parent_id for a reply and derives depth from the parent', async () => {
    const created = await createComment(101, { body: 'A reply', parent_id: 501 });

    expect(created.parent_id).toBe(501);
    expect(created.depth).toBe(1);
  });

  it('sends a fresh idempotency key per submission', async () => {
    const keys: Array<string | null> = [];
    server.use(
      http.post(COMMENTS_PATH, ({ request }) => {
        keys.push(request.headers.get(IDEMPOTENCY_HEADER));
        return HttpResponse.json({ id: 900 }, { status: 201 });
      }),
    );

    await createComment(101, { body: 'First' });
    await createComment(101, { body: 'Second' });

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[\w-]{8,128}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('normalises a validation failure into an AppApiError', async () => {
    server.use(
      http.post(COMMENTS_PATH, () =>
        HttpResponse.json(errorBody('VALIDATION_ERROR', 422), { status: 422 }),
      ),
    );

    const error = await createComment(101, { body: ' ' }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.isClientError).toBe(true);
  });

  it('surfaces the depth limit as a client error', async () => {
    // 503 is already a reply (depth 1): replying to it is refused by the backend.
    const error = await createComment(101, { body: 'Too deep', parent_id: 503 }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('COMMENT_DEPTH_EXCEEDED');
  });

  it('carries the type the request body allows', () => {
    // Compile-time guard: `body` is required, `parent_id` is optional/nullable.
    const body: CommentCreateBody = { body: 'Hi', parent_id: null };

    expect(body.parent_id).toBeNull();
  });
});
