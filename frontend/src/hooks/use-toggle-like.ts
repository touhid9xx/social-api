'use client';

import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { type LikeTargetType, likeTarget, unlikeTarget } from '@/lib/api/likes';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Like / unlike a post or a comment, optimistically.
 *
 * `POST|DELETE /likes/…` answer `204` with no body, so there is nothing to
 * merge — the visible state is patched in the cache and rolled back verbatim if
 * the request fails. Three rules make the patch safe:
 *
 *  1. Every list is ONE infinite cache entry (`pageParam` owns the cursor), so a
 *     like touches every page through `setQueriesData` on a key PREFIX — there
 *     is no per-page bookkeeping to get wrong.
 *  2. The previous data is snapshotted before the patch and restored on error,
 *     so a failed like cannot leave a count that never existed.
 *  3. `like_count` is clamped at zero: an optimistic count must never render
 *     `-1` if the server and the cache disagree about the starting value.
 *
 * The same mutation serves both targets because the backend does: one endpoint,
 * `target_type` of `post` or `comment`. Which caches to touch is therefore
 * decided by the target, not by the caller:
 *  - `post`    → `feed.all` (cards) and `posts.all` (detail + author lists);
 *  - `comment` → `posts.all`, patching the comment wherever it appears,
 *    including inside a top-level comment's `replies`.
 *
 * No refetch on success: the mutation already describes the new state, and
 * refetching a scrolled list would throw away the user's position. The next real
 * read reconciles anything else.
 */

/** The desired end state — not a toggle, so a double-tap cannot flip twice. */
export type ToggleLikeVars = {
  targetType: LikeTargetType;
  targetId: number;
  liked: boolean;
};

type Likable = {
  id: number;
  like_count: number;
  is_liked_by_me: boolean;
};

/**
 * A comment also has `post_id` and (optionally) `replies`; a post has none.
 * `post_id` is the discriminator because `PostView` never carries it.
 */
type CommentNode = Likable & {
  post_id: number;
  replies?: CommentNode[];
};

function applyLike<T extends Likable>(item: T, liked: boolean): T {
  if (item.is_liked_by_me === liked) return item;

  return {
    ...item,
    is_liked_by_me: liked,
    like_count: Math.max(0, item.like_count + (liked ? 1 : -1)),
  };
}

/** Replies are serialised one level deep, but recurse so a deeper thread is safe. */
function patchComment(node: CommentNode, targetId: number, liked: boolean): CommentNode {
  const patched = node.id === targetId ? applyLike(node, liked) : node;
  const replies = patched.replies;

  if (!replies || replies.length === 0) return patched;

  return { ...patched, replies: replies.map((reply) => patchComment(reply, targetId, liked)) };
}

function patchEntity(entity: unknown, { targetType, targetId, liked }: ToggleLikeVars): unknown {
  if (typeof entity !== 'object' || entity === null) return entity;

  const record = entity as Record<string, unknown>;
  if (typeof record.id !== 'number') return entity;

  const isComment = 'post_id' in record;

  if (targetType === 'comment') {
    return isComment ? patchComment(entity as CommentNode, targetId, liked) : entity;
  }

  if (isComment) return entity;
  return record.id === targetId ? applyLike(entity as Likable, liked) : entity;
}

/**
 * Patch either one entity or one infinite query. Both shapes live under the
 * same key family (`posts.all` holds a detail entry *and* infinite lists), so a
 * single updater has to recognise `pages`.
 */
function patchQueryData(data: unknown, vars: ToggleLikeVars): unknown {
  const pages = (data as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) return patchEntity(data, vars);

  const infinite = data as InfiniteData<unknown, string | undefined>;

  return {
    ...infinite,
    pages: infinite.pages.map((page) => {
      const items = (page as { items?: unknown }).items;
      if (!Array.isArray(items)) return page;

      return { ...(page as object), items: items.map((item) => patchEntity(item, vars)) };
    }),
  };
}

export function useToggleLike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetType, targetId, liked }: ToggleLikeVars) =>
      liked ? likeTarget(targetType, targetId) : unlikeTarget(targetType, targetId),

    onMutate: async (vars: ToggleLikeVars) => {
      // A refetch landing mid-flight would overwrite the optimistic value with
      // the pre-like one, then the rollback would put the stale value back.
      await queryClient.cancelQueries({ queryKey: queryKeys.feed.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.posts.all });

      const snapshot = [
        ...queryClient.getQueriesData<unknown>({ queryKey: queryKeys.feed.all }),
        ...queryClient.getQueriesData<unknown>({ queryKey: queryKeys.posts.all }),
      ];

      queryClient.setQueriesData<unknown>({ queryKey: queryKeys.feed.all }, (data: unknown) =>
        patchQueryData(data, vars),
      );
      queryClient.setQueriesData<unknown>({ queryKey: queryKeys.posts.all }, (data: unknown) =>
        patchQueryData(data, vars),
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
