'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type FollowCounts, followUser, type FollowStatus, unfollowUser } from '@/lib/api/follows';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Follow / unfollow, optimistically.
 *
 * `POST|DELETE /follows/{user_id}` answer `204` with no body, so there is nothing
 * to merge: `is_following` and the follower total are patched in the cache and
 * rolled back verbatim if the request fails.
 *
 * Three details that matter:
 *
 *  1. The caller passes the DESIRED state, not a toggle. A double-tap while the
 *     first request is in flight would otherwise fire `follow` twice and leave
 *     the button and the server disagreeing.
 *  2. Only the follower count of the target moves. The viewer's own `following`
 *     total is not in the cache unless they are looking at their own profile, and
 *     guessing its id here would be worse than refetching it later.
 *  3. The snapshot is taken before the patch, so a 403 (`has_blocked_me`) cannot
 *     leave a follower count that never existed.
 *
 * No refetch on success: the mutation already describes the new state, and the
 * next read reconciles anything else.
 */

export type ToggleFollowVars = {
  userId: number;
  following: boolean;
};

export function useToggleFollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, following }: ToggleFollowVars) =>
      following ? followUser(userId) : unfollowUser(userId),

    onMutate: async ({ userId, following }: ToggleFollowVars) => {
      const statusKey = queryKeys.users.followStatus(userId);
      const countsKey = queryKeys.users.followCounts(userId);

      // A refetch landing mid-flight would overwrite the optimistic value with
      // the pre-follow one, then the rollback would put the stale value back.
      await queryClient.cancelQueries({ queryKey: statusKey });
      await queryClient.cancelQueries({ queryKey: countsKey });

      const previousStatus = queryClient.getQueryData<FollowStatus>(statusKey);
      const previousCounts = queryClient.getQueryData<FollowCounts>(countsKey);

      if (previousStatus) {
        queryClient.setQueryData<FollowStatus>(statusKey, {
          ...previousStatus,
          is_following: following,
        });
      }

      if (previousCounts) {
        queryClient.setQueryData<FollowCounts>(countsKey, {
          ...previousCounts,
          followers: Math.max(0, previousCounts.followers + (following ? 1 : -1)),
        });
      }

      return { statusKey, countsKey, previousStatus, previousCounts };
    },

    onError: (_error, _vars, context) => {
      if (!context) return;

      // `undefined` means the entry was not cached, so there is nothing to
      // restore — writing `undefined` would create an empty entry instead.
      if (context.previousStatus !== undefined) {
        queryClient.setQueryData(context.statusKey, context.previousStatus);
      }
      if (context.previousCounts !== undefined) {
        queryClient.setQueryData(context.countsKey, context.previousCounts);
      }
    },
  });
}
