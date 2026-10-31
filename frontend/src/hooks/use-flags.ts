'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { getFlags, setFlagOverride } from '@/lib/api/flags';
import type { FlagOverride } from '@/lib/api/flags';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The flag table as a plain (non-paginated) query.
 *
 * `GET /flags` returns every known flag in one response — there is no cursor and
 * no filter on the endpoint — so this is `useQuery`, unlike the report queue.
 *
 * Admin-only: a non-admin gets `403 FORBIDDEN`, which `query-provider.tsx` does
 * not retry (it skips 4xx), so the screen settles into its "admins only" state
 * instead of retrying forever.
 */
export function useFlags() {
  return useQuery({
    queryKey: queryKeys.flags.list(),
    queryFn: getFlags,
  });
}

export type FlagOverrideVariables = {
  flagName: string;
} & FlagOverride;

/**
 * Set or clear one user's flag override.
 *
 * Deliberately invalidates nothing: `FlagView` carries only `env_value` and
 * `builtin_value`, neither of which a per-user override can change, so
 * refetching the list would re-read the same bytes. The caller reports the
 * mutation's echoed response instead (`action` + `enabled`), which is the only
 * evidence the server actually applied it.
 *
 * Not optimistic, for the same reason the consent switches are not: the write
 * can be refused (403 for a non-admin, 400 for an unknown flag) and painting the
 * new value first would claim a change that did not happen.
 */
export function useSetFlagOverride() {
  return useMutation({
    mutationFn: ({ flagName, ...payload }: FlagOverrideVariables) =>
      setFlagOverride(flagName, payload),
  });
}
