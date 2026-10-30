'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getFollowers, getFollowing } from '@/lib/api/follows';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The two ends of the follow graph, as one infinite query each.
 *
 * `followers/{id}` and `following/{id}` serialise the same `FollowListPage`, so
 * one hook serves both screens and only the key plus the fetcher differ — the
 * `kind` argument is what keeps them in separate caches.
 *
 * Who may see the list is the backend's call: a private account answers a
 * follower list to its owner only, and the page surfaces that as a retryable
 * error rather than pretending the list is empty.
 */
export type FollowListKind = 'followers' | 'following';

export function useFollowList(
  userId: number,
  kind: FollowListKind,
  limit: number = DEFAULT_PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey:
      kind === 'followers'
        ? queryKeys.users.followers(userId, { limit })
        : queryKeys.users.following(userId, { limit }),
    queryFn: ({ pageParam }) =>
      kind === 'followers'
        ? getFollowers(userId, { cursor: pageParam, limit })
        : getFollowing(userId, { cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
