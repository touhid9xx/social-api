import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Admin dashboard — `GET /api/v1/admin/dashboard` [contracts/api_reference.md:12].
 *
 * One endpoint returns every section (users, content, storage, traffic, workers)
 * so the page costs a single round trip. There is no cursor and no filter beyond
 * the window, so this is a plain read, not an infinite query.
 *
 * `window_days` is bounded server-side to `1..365`; anything outside that is a
 * 422, so the caller clamps before asking (see `DashboardWindow`).
 *
 * Two sections carry an `available` flag instead of pretending to be zero:
 * `traffic` is `false` when visit analytics is switched off or has recorded
 * nothing yet, and `workers` is `false` when Redis could not be reached. The UI
 * must render "no data" for those rather than a wall of zeros.
 *
 * Admin-only server-side (`require_roles(UserRole.ADMIN)`): a `403` is a normal
 * outcome for a non-admin and becomes the "admins only" state.
 */

export type DashboardOverview = components['schemas']['DashboardOverview'];

export type DashboardUsers = components['schemas']['UsersSummary'];

export type DashboardContent = components['schemas']['ContentSummary'];

export type DashboardStorage = components['schemas']['StorageSummary'];

export type DashboardTraffic = components['schemas']['TrafficSummary'];

export type DashboardWorkers = components['schemas']['WorkersSummary'];

export type DashboardDailyPoint = components['schemas']['DailyPoint'];

export type DashboardRegionRow = components['schemas']['RegionRow'];

export type DashboardPathClassRow = components['schemas']['PathClassRow'];

export type DashboardStorageConsumer = components['schemas']['StorageConsumers'];

/** The windows the page offers. Mirrors the server's `ge=1, le=365` bound. */
export const DASHBOARD_WINDOWS = [7, 30, 90] as const;

export type DashboardWindow = (typeof DASHBOARD_WINDOWS)[number];

export const DEFAULT_DASHBOARD_WINDOW: DashboardWindow = 30;

export function isDashboardWindow(value: number): value is DashboardWindow {
  return (DASHBOARD_WINDOWS as readonly number[]).includes(value);
}

export async function getDashboard(
  windowDays: DashboardWindow = DEFAULT_DASHBOARD_WINDOW,
): Promise<DashboardOverview> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/admin/dashboard', {
      params: { query: { window_days: windowDays } },
    }),
  );
}
