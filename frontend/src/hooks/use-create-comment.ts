'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createComment } from '@/lib/api/comments';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Post a comment or a reply, then reconcile the caches it touched.
 *
 * No optimistic insert, for the same reason `useCreatePost` has none: the
 * server decides `id`, `created_at` and `depth` (a reply's depth is
 * `parent.depth + 1`, and it may legitimately fail with
 * `COMMENT_DEPTH_EXCEEDED`). An invented row would have to be removed again on
 * failure, and it would sit at the wrong end of an ascending reply list.
 *
 * Two cache writes on success:
 *  - the thread is INVALIDATED, because a new comment changes pagination —
 *    refetching the first page is the only way to place it correctly;
 *  - `comment_count` is PATCHED on the post in the detail cache and on every
 *    feed page. A refetch there would be a wasted request that also resets the
 *    reader's scroll position, and the new count is known exactly (+1), so no
 *    optimistic guess is involved.
 */
export type CreateCommentVars = {
  postId: number;
  body: string;
  /** `null`/omitted comments on the post; an id replies to that comment. */
  parentId?: number | null;
};

/** `PostView` in either shape: one entity, or one page of an infinite list. */
function bumpPostCommentCount(data: unknown, postId: number): unknown {
  const pages = (data as { pages?: unknown } | null)?.pages;

  if (!Array.isArray(pages)) {
    const post = data as { id?: unknown; comment_count?: unknown } | null;
    if (!post || post.id !== postId || typeof post.comment_count !== 'number') return data;

    return { ...post, comment_count: post.comment_count + 1 };
  }

  return {
    ...(data as object),
    pages: pages.map((page) => {
      const items = (page as { items?: unknown }).items;
      if (!Array.isArray(items)) return page;

      return {
        ...(page as object),
        items: items.map((item) => {
          const post = item as { id?: unknown; comment_count?: unknown };
          if (post.id !== postId || typeof post.comment_count !== 'number') return item;

          return { ...post, comment_count: post.comment_count + 1 };
        }),
      };
    }),
  };
}

export function useCreateComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, body, parentId }: CreateCommentVars) =>
      createComment(postId, { body, parent_id: parentId ?? null }),

    onSuccess: (_created, { postId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.commentThreads(postId) });

      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.posts.detail(postId) },
        (data: unknown) => bumpPostCommentCount(data, postId),
      );
      queryClient.setQueriesData<unknown>({ queryKey: queryKeys.feed.all }, (data: unknown) =>
        bumpPostCommentCount(data, postId),
      );
    },
  });
}
