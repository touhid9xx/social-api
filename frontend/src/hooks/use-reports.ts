'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { getReports, updateReport } from '@/lib/api/moderation';
import type { ReportStatus, ReportTransition } from '@/lib/api/moderation';
import { queryKeys } from '@/lib/api/query-keys';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

/**
 * The report queue as ONE infinite query per status filter.
 *
 * The cursor lives in `pageParam`, never in the key, so switching back to a
 * filter reuses its cache instead of refetching the first page.
 *
 * `status` DOES stay in the key (`listKey()` drops only the cursor): "open" and
 * "resolved" are different lists, and sharing one entry across them would show
 * closed reports under an open filter.
 */
export function useReports({
  limit = DEFAULT_PAGE_SIZE,
  status = null,
}: { limit?: number; status?: ReportStatus | null } = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.moderation.reports({ limit, status: status ?? undefined }),
    queryFn: ({ pageParam }) => getReports({ cursor: pageParam, limit, status }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export type UpdateReportVariables = {
  reportId: number;
  /** The version the moderator was looking at — the optimistic lock. */
  version: number;
  status: ReportTransition;
  resolutionNote?: string | null;
};

/**
 * Transition one report.
 *
 * Deliberately NOT optimistic: the server can refuse a transition for reasons a
 * client cannot predict (terminal-state lock, a concurrent reviewer, a stale
 * version), and painting "resolved" before the server agrees would lie on the
 * screen. Instead the whole `moderation` family is invalidated on success, so a
 * report that left an "open" filter disappears from it.
 */
export function useUpdateReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ reportId, version, status, resolutionNote }: UpdateReportVariables) =>
      updateReport(reportId, {
        version,
        status,
        resolution_note: resolutionNote ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.moderation.all }),
  });
}
