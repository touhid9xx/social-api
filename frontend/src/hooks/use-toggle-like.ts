'use client';

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import type { FeedPost, HomeFeedPage } from '@/lib/api/feed';
import { likeTarget, unlikeTarget } from '@/lib/api/likes';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Like / unlike a post, optimistically.
 *
 * `POST|DELETE /likes/…` answer `204` with no body, so there is nothing to
 * merge — the visible state is patched in the cache and rolled back if the
 * request fails. Two rules make the patch safe:
 *
 *  1. The feed is ONE infinite cache entry (`pageParam` owns the cursor), so a
 *     like touches every page through `setQueriesData` on the `feed.all`
 *     prefix — there is no per-page bookkeeping to get wrong.
 *  2. The previous data is snapshotted before the patch and restored verbatim
 *     on error, so a failed like cannot leave a count that never existed.
 *
 * `like_count` is clamped at zero: an optimistic count must never render `-1`
 * if the server and the cache disagree about the starting value.
 *
 * No refetch on success: the mutation already describes the new state, and
 * refetching a scrolled infinite list would throw away the user's position.
 * The next real read of the feed reconciles anything else.
 */

/** The desired end state — not a toggle, so a double-tap cannot flip twice. */
export type ToggleLikeVars = {
  postId: number;
  liked: boolean;
};

type FeedData = InfiniteData<HomeFeedPage, string | undefined>;

function applyLike(post: FeedPost, liked: boolean): FeedPost {
  if (post.is_liked_by_me === liked) return post;

  return {
    ...post,
    is_liked_by_me: liked,
    like_count: Math.max(0, post.like_count + (liked ? 1 : -1)),
  };
}

function patchFeed(data: FeedData, postId: number, liked: boolean): FeedData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((post) => (post.id === postId ? applyLike(post, liked) : post)),
    })),
  };
}

export function useToggleLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, liked }: ToggleLikeVars) =>
      liked ? likeTarget('post', postId) : unlikeTarget('post', postId),

    onMutate: async ({ postId, liked }) => {
      // A refetch landing mid-flight would overwrite the optimistic value with
      // the pre-like one, then the rollback would put the stale value back.
      await queryClient.cancelQueries({ queryKey: queryKeys.feed.all });

      const snapshot = queryClient.getQueriesData<FeedData>({ queryKey: queryKeys.feed.all });

      queryClient.setQueriesData<FeedData>({ queryKey: queryKeys.feed.all }, (data) =>
        data ? patchFeed(data, postId, liked) : data,
      );

      return { snapshot };
    },

    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
  });
}
