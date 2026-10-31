'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setAvatar, uploadMedia } from '@/lib/api/media';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Upload an image and make it the caller's profile picture.
 *
 * Two backend calls, in this order: `POST /media` (bytes) then
 * `POST /media/{id}/avatar` (promotion). The avatar field is set by id, not by
 * URL, so a client cannot point its own profile at a third-party host.
 *
 * Invalidating `users.all` — rather than just `users.me` — is the load-bearing
 * part. The feed serialises `author_id` only, so every card, comment, follow row
 * and chat header reads the author's avatar from its own `users.profile(id)`
 * cache entry. Refreshing only `users.me` would leave the user looking at their
 * old picture on their own posts while their settings screen showed the new one.
 *
 * `users.all` includes `users.me`, so one prefix invalidation covers both.
 */
export function useSetAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<void> => {
      const uploaded = await uploadMedia(file);
      await setAvatar(uploaded.id);
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}
