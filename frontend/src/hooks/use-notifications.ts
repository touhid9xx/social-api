'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getNotifications } from '@/lib/api/notifications';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The notification inbox as ONE infinite query.
 *
 * The cursor lives in `pageParam`, never in the query key, so
 * `notifications.list(...)` stays a single cache entry no matter how far the
 * user pages — and invalidating it refetches from the top.
 *
 * `unreadOnly` DOES stay in the key (`listKey()` drops only the cursor): an
 * unread-only inbox is a genuinely different list, and mixing the two would
 * show read rows under a filter that promised none.
 */
export function useNotifications({
  limit = DEFAULT_PAGE_SIZE,
  unreadOnly = false,
}: { limit?: number; unreadOnly?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications.list({ limit, unreadOnly }),
    queryFn: ({ pageParam }) => getNotifications({ cursor: pageParam, limit, unreadOnly }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
