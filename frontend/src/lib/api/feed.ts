import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * `GET /api/v1/feed/home` — [contracts/api_reference.md:1019].
 *
 * Types come from the generated OpenAPI document, so the response shape is the
 * backend's `HomeFeedPage` verbatim: `{ items, next_cursor, cache_hit }`.
 * `next_cursor` is OPAQUE — never parse it, never derive an offset from it,
 * never put it in a cache key (see `./query-keys.ts`).
 */

export type HomeFeedPage = components['schemas']['HomeFeedPage'];

/**
 * `GET /api/v1/feed/explore` — the discovery feed.
 *
 * Same envelope as the home feed and the same `PostView` items; what differs is
 * the backend's selection (ranked discovery instead of the follow graph), not the
 * shape. That is why the UI shares one list component across both.
 */
export type ExploreFeedPage = components['schemas']['ExploreFeedPage'];

/** One post as the feed serialises it. `author_id` is an id, not an author. */
export type FeedPost = HomeFeedPage['items'][number];

/**
 * What every feed endpoint has in common: a page of posts plus an opaque cursor.
 * The shared list component is written against this, so a feed is a feed.
 */
export type FeedPage = {
  items: FeedPost[];
  next_cursor?: string | null;
};

export type FeedQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 50 (`le=50`); the contract wins, not the UI. */
  limit?: number;
};

export async function getHomeFeed({
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
}: FeedQuery = {}): Promise<HomeFeedPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/feed/home', {
      params: { query: { cursor, limit } },
    }),
  );
}

/**
 * `GET /api/v1/feed/explore` — the discovery feed
 * — [contracts/api_reference.md:1063].
 *
 * Same request shape as `getHomeFeed`: the viewer is the bearer token, not a
 * query param, so there is nothing to pass but the cursor. The backend decides
 * what "worth exploring" means (`FeedService.explore`), which is exactly why
 * the client must not filter or reorder — it renders what comes back.
 */
export async function getExploreFeed({
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
}: FeedQuery = {}): Promise<ExploreFeedPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/feed/explore', {
      params: { query: { cursor, limit } },
    }),
  );
}
