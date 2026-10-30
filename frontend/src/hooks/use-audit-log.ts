'use client';

import { useInfiniteQuery } from '@tanstack/react-query';

import { getAuditLog } from '@/lib/api/audit';
import type { AuditAction, AuditEntity } from '@/lib/api/audit';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The admin audit trail as ONE infinite query.
 *
 * The cursor lives in `pageParam`, never in the key; the two filters do stay in
 * the key because a filtered trail is a genuinely different list.
 *
 * The endpoint is admin-only. A non-admin caller gets `403 FORBIDDEN`, and the
 * query is retried zero times for that (`query-provider.tsx` skips 4xx), so the
 * page settles into its "staff only" state without a retry storm.
 */
export function useAuditLog({
  limit = DEFAULT_PAGE_SIZE,
  action = null,
  entity = null,
}: {
  limit?: number;
  action?: AuditAction | null;
  entity?: AuditEntity | null;
} = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.audit.list({
      limit,
      action: action ?? undefined,
      entity: entity ?? undefined,
    }),
    queryFn: ({ pageParam }) => getAuditLog({ cursor: pageParam, limit, action, entity }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}
