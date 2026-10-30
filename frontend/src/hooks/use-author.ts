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
 *
 * `authorId` is `number | undefined` because callers sometimes learn the id
 * asynchronously — the peer of a direct chat room is only known once the member
 * list resolves — and a hook cannot be called conditionally. With no id the
 * query is DISABLED, so the placeholder key below is never fetched. `0` cannot
 * collide with a real user (`ge=1` on every profile route).
 */
export function useAuthor(authorId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.users.profile(authorId ?? 0),
    queryFn: () => getProfile(authorId ?? 0),
    enabled: authorId !== undefined,
    staleTime: 5 * 60_000,
  });
}
