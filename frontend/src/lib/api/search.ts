import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { DEFAULT_PAGE_SIZE } from '../constants';

/** One person in the results. Mirrors `FollowUserView`: id, name, avatar only. */
export type SearchUserHit = components['schemas']['SearchUserHit'];

export type SearchResults = components['schemas']['SearchResults'];

/**
 * The shortest term the backend accepts (`QUERY_TOO_SHORT` below this).
 *
 * Lives here, next to the request, because a single-character query is the one
 * 400 that is cheaper to never send than to explain: every keystroke below the
 * floor would otherwise be a round trip that can only fail.
 */
export const SEARCH_MIN_TERM_LENGTH = 2;

export type SearchQuery = {
  /** The raw term. Trimmed here so the caller can pass an input value as-is. */
  term: string;
  /**
   * Opaque post cursor from the previous page. `null`/omitted asks for the
   * first.
   *
   * It only advances the **post** list: the people block is capped server-side
   * and arrives complete on every page, so paging does not reshuffle it.
   */
  cursor?: string | null;
  limit?: number;
};

/**
 * `GET /api/v1/search` — people and posts in a single round trip.
 *
 * Four things worth knowing before using it:
 *
 *  1. The envelope is `{ query, users, posts, next_cursor }` — **not** the usual
 *     `{ items, next_cursor }`. Two different result kinds travel together, so
 *     both lists are named; adapting it for `PostFeed` is one `map` at the call
 *     site rather than a second pagination implementation.
 *  2. `next_cursor` paginates posts only. `users` is a shortlist (the backend
 *     caps it at ten) and is repeated on later pages — a caller that appends
 *     pages must keep only the newest `users` array, or dedupe by `user_id`.
 *  3. The backend trims `q` and enforces `SEARCH_MIN_TERM_LENGTH` itself; the
 *     `min_length=1` in the contract only stops an empty string. So a short term
 *     is a real `400 QUERY_TOO_SHORT`, which is why `useSearch` refuses to fire
 *     below the floor instead of catching the error.
 *  4. Every post in `posts` is already filtered for visibility server-side
 *     (blocks in both directions included), so this client must not re-filter.
 *     The rows are plain `PostView`s, identical to the feed's.
 */
export async function searchContent({
  term,
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
}: SearchQuery): Promise<SearchResults> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/search', {
      params: { query: { q: term.trim(), cursor, limit } },
    }),
  );
}
