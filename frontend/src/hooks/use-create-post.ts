'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { attachMediaToPost, type MediaView, uploadMedia } from '@/lib/api/media';
import { createPost, type PostCreateBody, type PostView } from '@/lib/api/posts';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Publish a post, optionally with media, then refetch the lists that show it.
 *
 * No optimistic insert: the new post's `id`, `created_at` and rank are the
 * server's to decide (the feed is a hybrid fan-out, not chronological —
 * `docs/adr/003-hybrid-feed-fanout.md`), so an invented card would land in the
 * wrong place and then jump. The composer instead clears itself and the feed
 * refetches from the top, which is one request and always correct.
 *
 * Media is a **two-step** backend flow (`POST /media` → `POST /media/{id}/
 * attach/{post_id}` — see `@/lib/api/media`), so the sequence is
 * create → upload → attach, one file at a time. It is deliberately NOT
 * transactional: if an upload fails the post already exists, and the mutation
 * rejects so the composer can say "published, but N attachments failed". A
 * rollback (delete the post) would silently discard text the user typed,
 * which is the worse outcome.
 *
 * `posts.all` is invalidated too: the author's own post list is a different
 * cache entry, and it is now stale.
 */

export type PublishPostInput = {
  values: PostCreateBody;
  /** Already size-checked by the composer; order is preserved. */
  files?: File[];
};

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ values, files = [] }: PublishPostInput): Promise<PostView> => {
      const post = await createPost(values);
      if (files.length === 0) return post;

      const media: MediaView[] = [];
      for (const file of files) {
        const uploaded = await uploadMedia(file);
        media.push(await attachMediaToPost(uploaded.id, post.id));
      }
      return { ...post, media };
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
    },
  });
}
