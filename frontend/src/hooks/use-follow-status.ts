'use client';

import { useQuery } from '@tanstack/react-query';

import { getFollowStatus } from '@/lib/api/follows';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Is the viewer following this user (and are they blocked either way)?
 *
 * The answer is viewer-relative, so this can never be cached across sessions —
 * the query cache is cleared on sign-out (`sign-out-button.tsx`), which is what
 * makes the id-only key honest. It must not be prefetched or server-rendered
 * into a shared cache for the same reason.
 *
 * `staleTime` is short: a follow made on another device should show up on the
 * next profile visit rather than five minutes later.
 */
export function useFollowStatus(userId: number) {
  return useQuery({
    queryKey: queryKeys.users.followStatus(userId),
    queryFn: () => getFollowStatus(userId),
    staleTime: 30_000,
  });
}
