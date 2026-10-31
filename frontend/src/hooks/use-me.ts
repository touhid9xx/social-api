'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { getMe } from '@/lib/api/users';

/**
 * The signed-in user's own profile.
 *
 * One cache entry for the whole session (`queryKeys.users.me()`), so every screen
 * that needs "am I looking at myself" shares a single request. `staleTime` is
 * long: a display name or bio changing under the reader is not a refresh anyone
 * asked for, and settings writes invalidate the key explicitly.
 *
 * It is NOT the same type as `useAuthor` — `GET /users/me` returns `ProfileSelf`
 * with the owner's PII, while `/users/{id}` returns `ProfilePublic`. They also
 * live in different key families on purpose, so rendering a public profile can
 * never be served from the owner-only cache entry.
 */
export function useMe({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.users.me(),
    queryFn: getMe,
    staleTime: 5 * 60_000,
    // The primary nav renders in the shell, outside `RequireSession`, so on the
    // sign-in screens there is no token and this read would be a guaranteed 401.
    // Callers that live behind the guard leave it at the default.
    enabled,
  });
}
