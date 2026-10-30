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

/** One post as the feed serialises it. `author_id` is an id, not an author. */
export type FeedPost = HomeFeedPage['items'][number];

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
