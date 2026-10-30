'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { getProfile } from '@/lib/api/users';

/**
 * One author profile, cached per user id.
 *
 * The feed serialises `author_id` only, so this is how a card learns a display
 * name and avatar. Ten posts by the same person share a single cache entry and
 * a single request; scrolling back refetches nothing.
 *
 * `staleTime` is longer than the feed's 30s: a display name changing under a
 * scrolling user is not a refresh anyone asked for.
 */
export function useAuthor(authorId: number) {
  return useQuery({
    queryKey: queryKeys.users.profile(authorId),
    queryFn: () => getProfile(authorId),
    staleTime: 5 * 60_000,
  });
}
