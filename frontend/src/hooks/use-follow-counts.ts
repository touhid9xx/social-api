'use client';

import { useQuery } from '@tanstack/react-query';

import { getFollowCounts } from '@/lib/api/follows';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Follower / following totals for a profile.
 *
 * Kept separate from `useFollowStatus` because they are separate endpoints with
 * genuinely different cache lifetimes: the counts are public and change slowly,
 * while the status is private and changes the moment the button is pressed.
 * Splitting them means following someone refetches neither.
 */
export function useFollowCounts(userId: number) {
  return useQuery({
    queryKey: queryKeys.users.followCounts(userId),
    queryFn: () => getFollowCounts(userId),
    staleTime: 60_000,
  });
}
