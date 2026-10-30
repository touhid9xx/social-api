'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getPostComments } from '@/lib/api/comments';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * One post's comment thread as ONE infinite query.
 *
 * Only TOP-LEVEL comments are paginated; each one carries its replies inline
 * (`CommentPage.items[].replies`), which is why the UI never needs a second
 * endpoint or a second cache entry per comment. `MAX_COMMENT_DEPTH = 2` on the
 * server means a reply cannot be replied to, so the tree is exactly two levels.
 *
 * The cursor lives in `pageParam`, never in the query key: `posts.comments(id)`
 * stays a single cache entry no matter how far the user scrolls, and
 * invalidating it refetches from the top.
 *
 * `getNextPageParam` returns `next_cursor ?? undefined` — `undefined` is
 * TanStack's "no more pages", while `null` would be sent back as a literal
 * cursor.
 */
export function useComments(postId: number, limit: number = DEFAULT_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: queryKeys.posts.comments(postId, { limit }),
    queryFn: ({ pageParam }) => getPostComments(postId, { cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Number.isFinite(postId) && postId > 0,
  });
}
