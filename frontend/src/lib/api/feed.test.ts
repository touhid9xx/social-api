import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError, isAppApiError } from './errors';
import { getHomeFeed, type HomeFeedPage } from './feed';

/**
 * The home feed endpoint.
 *
 * Two things here are load-bearing for the whole feed UI:
 *  1. `next_cursor` is opaque and round-trips verbatim — the client must never
 *     invent an offset from it, or pagination silently skips posts.
 *  2. `limit`/`cursor` reach the wire as query params, with the first page
 *     sending no cursor at all (a literal `null` would be a real cursor).
 *
 * (cursor অপরিবর্তিত ফেরত যেতে হবে, আর প্রথম পাতায় cursor পাঠানো যাবে না।)
 */

const FEED_PATH = '/api/v1/feed/home';

function errorBody(error: string, status: number): ApiErrorBody {
  return { error, status, detail: 'test', path: FEED_PATH, request_id: 'test-request-id' };
}

describe('getHomeFeed', () => {
  it('returns the first page with an opaque next cursor', async () => {
    const page = await getHomeFeed({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.next_cursor).toBe('2');
    expect(page.cache_hit).toBe(false);
  });

  it('round-trips the cursor and reports the end of the feed with null', async () => {
    const second = await getHomeFeed({ cursor: '2', limit: 2 });

    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
  });

  it('sends limit as a query param and omits the cursor on the first page', async () => {
    const captured: { url?: URL } = {};
    server.use(
      http.get(`*${FEED_PATH}`, ({ request }) => {
        captured.url = new URL(request.url);
        const empty: HomeFeedPage = { items: [], next_cursor: null, cache_hit: false };
        return HttpResponse.json(empty);
      }),
    );

    await getHomeFeed({ limit: 5 });

    expect(captured.url?.searchParams.get('limit')).toBe('5');
    expect(captured.url?.searchParams.has('cursor')).toBe(false);
  });

  it('passes the cursor through untouched', async () => {
    const captured: { url?: URL } = {};
    server.use(
      http.get(`*${FEED_PATH}`, ({ request }) => {
        captured.url = new URL(request.url);
        const empty: HomeFeedPage = { items: [], next_cursor: null, cache_hit: false };
        return HttpResponse.json(empty);
      }),
    );

    await getHomeFeed({ cursor: 'eyJvZmZzZXQiOjIwfQ', limit: 5 });

    expect(captured.url?.searchParams.get('cursor')).toBe('eyJvZmZzZXQiOjIwfQ');
  });

  it('normalises a backend error envelope into an AppApiError', async () => {
    server.use(
      http.get(`*${FEED_PATH}`, () =>
        HttpResponse.json(errorBody('RATE_LIMITED', 429), { status: 429 }),
      ),
    );

    await expect(getHomeFeed()).rejects.toBeInstanceOf(AppApiError);

    try {
      await getHomeFeed();
      throw new Error('Expected getHomeFeed to reject');
    } catch (error) {
      expect(isAppApiError(error)).toBe(true);
      if (!isAppApiError(error)) throw error;
      expect(error.status).toBe(429);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.path).toBe(FEED_PATH);
    }
  });
});
