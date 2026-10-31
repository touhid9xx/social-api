'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import type { LikeTargetType } from '@/lib/api/likes';
import { getLikers } from '@/lib/api/likes';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * Who liked one post or one comment, as ONE infinite query.
 *
 * The cursor lives in `pageParam`, never in the key: `posts.likers(type, id)`
 * stays a single cache entry however far the list is scrolled, and a prefix
 * invalidation refetches from the top.
 *
 * `enabled` is the caller's — the dialog passes `open` so nothing is fetched
 * until the list is actually wanted. Opening a dialog is an explicit request, so
 * the read is cheap enough to re-run per open; the default 30 s stale time still
 * absorbs a close-and-reopen.
 *
 * `getNextPageParam` returns `next_cursor ?? undefined`: `undefined` is
 * TanStack's "no more pages", while `null` would be sent back as the literal
 * cursor string "null".
 */
export function useLikers(
  targetType: LikeTargetType,
  targetId: number,
  { enabled = true, limit = DEFAULT_PAGE_SIZE }: { enabled?: boolean; limit?: number } = {},
) {
  return useInfiniteQuery({
    queryKey: queryKeys.posts.likers(targetType, targetId, { limit }),
    queryFn: ({ pageParam }) => getLikers(targetType, targetId, { cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: enabled && Number.isFinite(targetId) && targetId > 0,
  });
}
