'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { getAdminUsers } from '@/lib/api/users';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The staff-only user directory as ONE infinite query.
 *
 * The cursor goes into `pageParam`, never into the key — the endpoint accepts no
 * filter at all (only `cursor` and `limit`), so there is nothing else a key
 * could legitimately carry besides the page size.
 *
 * Admin-only: a non-admin gets `403 FORBIDDEN`, and `query-provider.tsx` does
 * not retry 4xx, so the screen settles into its "admins only" state instead of
 * retrying forever. That is the whole reason no client-side role check exists
 * here — `use-my-role.ts` is for hiding the *entry point*, not for guarding the
 * data.
 */
export function useAdminUsers({ limit = DEFAULT_PAGE_SIZE }: { limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.users.directory({ limit }),
    queryFn: ({ pageParam }) => getAdminUsers({ cursor: pageParam, limit }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
