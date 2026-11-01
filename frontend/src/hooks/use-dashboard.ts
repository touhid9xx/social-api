'use client';

import { useQuery } from '@tanstack/react-query';

import { getDashboard } from '@/lib/api/dashboard';
import type { DashboardWindow } from '@/lib/api/dashboard';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The admin overview as a plain query.
 *
 * `GET /admin/dashboard` answers every section in one response — no cursor, no
 * paging — so this is `useQuery`, unlike the audit trail. The window stays in
 * the key: a 7-day aggregate is a different read from the 30-day one, so
 * switching windows must not overwrite the previous result.
 *
 * The endpoint is admin-only. A non-admin gets `403 FORBIDDEN`, which
 * `query-provider.tsx` does not retry (it skips 4xx), so the screen settles into
 * its "admins only" state instead of retrying forever.
 *
 * `staleTime` is deliberately short-but-nonzero: these are operational counters
 * that move constantly, but a remount two seconds later does not need a second
 * aggregate over the whole `analytics_visit` table.
 */
export function useDashboard(windowDays: DashboardWindow) {
  return useQuery({
    queryKey: queryKeys.dashboard.overview(windowDays),
    queryFn: () => getDashboard(windowDays),
    staleTime: 30_000,
  });
}
