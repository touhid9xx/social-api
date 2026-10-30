'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getMessages } from '@/lib/api/chat';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * One room's messages as ONE infinite query, paging backwards in time.
 *
 * The backend orders `created_at DESC, id DESC`, so page 0 is the newest screen
 * of messages and `next_cursor` asks for OLDER ones. That direction is the whole
 * reason this hook exists rather than a plain loop: "load older" is
 * `fetchNextPage`, and the natural chat reading order (oldest at top) is applied
 * at render time by reversing the concatenated pages — reversing the QUERY would
 * break the cursor, which is built from each page's last (oldest) row.
 *
 * The cursor lives in `pageParam`, never in the key, so the thread stays a
 * single cache entry that can be invalidated or patched in place (sends prepend
 * to page 0 rather than refetching, see `use-chat-actions`).
 *
 * `enabled` on a valid room id so a malformed `/messages/[roomId]` cannot fire a
 * request for room `0`.
 */
export function useRoomMessages(roomId: number, limit: number = DEFAULT_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: queryKeys.chat.messages(roomId),
    queryFn: ({ pageParam }) => getMessages(roomId, { cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Number.isInteger(roomId) && roomId > 0,
  });
}
