'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getHomeFeed } from '@/lib/api/feed';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The home feed as ONE infinite query.
 *
 * The cursor lives in `pageParam`, never in the query key: `queryKeys.feed.home`
 * therefore stays a single cache entry no matter how far the user scrolls, and
 * invalidating it refetches from the top instead of orphaning pages.
 *
 * `getNextPageParam` returns `lastPage.next_cursor ?? undefined` — `undefined`
 * is TanStack's "no more pages", while `null` would be passed back to the API
 * as a literal cursor.
 */
export function useHomeFeed(limit: number = DEFAULT_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed.home({ limit }),
    queryFn: ({ pageParam }) => getHomeFeed({ cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
