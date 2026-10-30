'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createPost } from '@/lib/api/posts';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Publish a post, then refetch the lists that could show it.
 *
 * No optimistic insert: the new post's `id`, `created_at` and rank are the
 * server's to decide (the feed is a hybrid fan-out, not chronological —
 * `docs/adr/003-hybrid-feed-fanout.md`), so an invented card would land in the
 * wrong place and then jump. The composer instead clears itself and the feed
 * refetches from the top, which is one request and always correct.
 *
 * `posts.all` is invalidated too: the author's own post list is a different
 * cache entry, and it is now stale.
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}
