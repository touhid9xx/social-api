'use client';

import { useQuery } from '@tanstack/react-query';

import { getPresence } from '@/lib/api/presence';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * How long an "online" answer stays believable.
 *
 * The backend refills the presence key from the socket heartbeat, so the truth
 * changes without any frame reaching this tab. The contract has no presence
 * transition event, which leaves a fixed re-read as the only honest option: a
 * cached dot must not survive long enough to outlive the TTL it came from.
 */
export const PRESENCE_STALE_TIME_MS = 30_000;

/**
 * Presence for one user, or nothing when `userId` is `undefined`.
 *
 * `undefined` is the group-room case: presence is a 1:1 signal here (the header
 * dot), and a group header would need one request per member. Callers pass the
 * peer id and get automatic gating.
 */
export function usePresence(userId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.users.presence(userId ?? 0),
    queryFn: () => getPresence(userId as number),
    enabled: userId !== undefined,
    staleTime: PRESENCE_STALE_TIME_MS,
  });
}
