'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { getPost } from '@/lib/api/posts';

/**
 * One post, for the detail route.
 *
 * Keyed under `posts.detail(id)`, which is a CHILD of `posts.all` — so a post
 * created or edited anywhere else invalidates this entry along with every list
 * (see `query-keys.ts`).
 *
 * The response is the same `PostView` the feed serialises, so `PostCard` renders
 * it unchanged and the two views cannot drift.
 *
 * `retry` is left to the shared client (`shouldRetry` in `query-provider.tsx`):
 * a 404 is final, a 5xx may not be.
 */
export function usePost(postId: number) {
  return useQuery({
    queryKey: queryKeys.posts.detail(postId),
    queryFn: () => getPost(postId),
  });
}
