'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { type ProfileUpdate, type SelfProfile, updateMe } from '@/lib/api/users';

/**
 * Save the settings profile form.
 *
 * `PATCH /users/me` returns the whole updated `ProfileSelf`, so the response is
 * written straight into `queryKeys.users.me()`: that is also how the next submit
 * picks up the bumped `version`, which is what makes the second save of a
 * session succeed instead of tripping the optimistic lock.
 *
 * The PUBLIC profile of the same user is invalidated rather than patched — it is
 * a different type (`ProfilePublic`) rendered by the profile screen and the feed
 * cards, and a renamed display name has to stop appearing under old posts. Those
 * cache entries may not exist, which costs nothing: invalidating an absent key is
 * a no-op.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ProfileUpdate) => updateMe(payload),

    onSuccess: (profile: SelfProfile) => {
      queryClient.setQueryData<SelfProfile>(queryKeys.users.me(), profile);
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(profile.user_id) });
    },
  });
}
