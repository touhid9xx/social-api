'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getExploreFeed } from '@/lib/api/feed';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The discovery feed as ONE infinite query — the exact shape of `useHomeFeed`.
 *
 * Same contract, different selection: the backend ranks instead of walking the
 * follow graph, but the envelope (`items`, opaque `next_cursor`) and therefore
 * the pagination logic are identical. Only the query key separates the two
 * caches, so exploring can never evict or overwrite the home feed.
 *
 * `getNextPageParam` returns `next_cursor ?? undefined` — `undefined` is
 * TanStack's "no more pages", while `null` would be sent back as a literal
 * cursor.
 */
export function useExploreFeed(limit: number = DEFAULT_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed.explore({ limit }),
    queryFn: ({ pageParam }) => getExploreFeed({ cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
