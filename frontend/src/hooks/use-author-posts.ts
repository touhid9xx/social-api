'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getAuthorPosts } from '@/lib/api/posts';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * One author's posts as a single infinite query — the profile's feed.
 *
 * `GET /posts/by-author/{author_id}` returns the same envelope the feeds do, so
 * the pages slot straight into `PostFeed` and the pagination, dedup and
 * load-more-failure handling are shared rather than reimplemented per screen.
 *
 * The key is scoped to the author, so opening two profiles keeps two caches and
 * invalidating `posts.byAuthor(id)` never touches anyone else's list.
 *
 * `getNextPageParam` returns `next_cursor ?? undefined`: `undefined` is
 * TanStack's "no more pages", while `null` would be sent back as a literal
 * cursor.
 */
export function useAuthorPosts(authorId: number, limit: number = DEFAULT_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: queryKeys.posts.byAuthor(authorId, { limit }),
    queryFn: ({ pageParam }) => getAuthorPosts(authorId, { cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
