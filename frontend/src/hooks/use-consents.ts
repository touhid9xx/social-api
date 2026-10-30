'use client';

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { getConsents } from '@/lib/api/users';

/**
 * The user's marketing/analytics consent rows.
 *
 * Only channels the user has ever acted on are returned, so the consent screen
 * renders all four switches from this list and treats a missing channel as "off"
 * — the backend does not materialise a row per channel on registration.
 *
 * No `staleTime` override: consent is a legal record, not a preference to be
 * guessed at, and the mutation invalidates this key explicitly after every write.
 */
export function useConsents() {
  return useQuery({
    queryKey: queryKeys.users.consents(),
    queryFn: getConsents,
  });
}
