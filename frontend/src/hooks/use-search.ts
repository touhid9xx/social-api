'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { SEARCH_MIN_TERM_LENGTH, searchContent } from '@/lib/api/search';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * One term, paged — `GET /api/v1/search`.
 *
 * The trimmed term is part of the key (it IS the identity of the search), while
 * the cursor goes into `pageParam` so a single infinite query owns every page.
 *
 * `enabled` is the important part: the backend answers a term shorter than
 * `SEARCH_MIN_TERM_LENGTH` with `400 QUERY_TOO_SHORT`, and React Query does not
 * retry 4xx, so firing on every keystroke would litter the cache with errors a
 * user can do nothing about. Below the floor the hook stays idle and the screen
 * shows its "type at least N characters" hint instead. `term` is trimmed before
 * both the check and the key, so `"  ab  "` and `"ab"` are one cache entry.
 */
export function useSearch(term: string, { limit = DEFAULT_PAGE_SIZE }: { limit?: number } = {}) {
  const trimmed = term.trim();

  return useInfiniteQuery({
    queryKey: queryKeys.search.query(trimmed, { limit }),
    queryFn: ({ pageParam }) => searchContent({ term: trimmed, cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: trimmed.length >= SEARCH_MIN_TERM_LENGTH,
  });
}
