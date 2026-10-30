import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Report queue — [contracts/api_reference.md:2938].
 *
 * Two endpoints, both staff-only (`require_roles(MODERATOR, ADMIN)`), so a
 * signed-in non-staff user gets `403 FORBIDDEN` from both. The frontend has no
 * way to know the caller's role — `ProfileSelf` does not expose `role` — so the
 * UI renders and lets the 403 path explain itself instead of guessing.
 *
 *  - `GET   /moderation/reports`             cursor-paginated, optional `status`;
 *  - `PATCH /moderation/reports/{report_id}` optimistic-locked transition.
 *
 * The PATCH is NOT an `Idempotency-Key` route: it is guarded by `version`
 * instead, and `ReportView` now carries that version (it did not before, which
 * made the lock impossible to satisfy from a client). Terminal states are
 * further locked server-side — resolving twice is a no-op, but resolving an
 * already-dismissed report raises `REPORT_LOCKED`.
 */

export type ReportView = components['schemas']['ReportView'];

export type ReportPage = components['schemas']['ReportPage'];

export type ReportStatus = components['schemas']['ReportStatus'];

export type ReportUpdate = components['schemas']['ReportUpdate'];

/** Transitions a moderator may request. `open` is excluded by the contract. */
export type ReportTransition = ReportUpdate['status'];

/**
 * Every status the backend can store, in triage order. The filter select is
 * built from this list so a new status on the server cannot silently become
 * unfilterable, and each entry must exist under `admin.reports.status.*`.
 */
export const REPORT_STATUSES = ['open', 'under_review', 'resolved', 'dismissed'] as const;

/** The statuses a PATCH may move a report *to* (never back to `open`). */
export const REPORT_TRANSITIONS = ['under_review', 'resolved', 'dismissed'] as const;

export type ReportQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** `null` means "every status" — the backend treats a missing filter that way. */
  status?: ReportStatus | null;
  /** Backend caps this at 100 (`le=100`); the contract wins, not the UI. */
  limit?: number;
};

export async function getReports({
  cursor = null,
  status = null,
  limit = DEFAULT_PAGE_SIZE,
}: ReportQuery = {}): Promise<ReportPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/moderation/reports', {
      params: { query: { cursor, status, limit } },
    }),
  );
}

export async function updateReport(reportId: number, payload: ReportUpdate): Promise<ReportView> {
  return apiRequest(() =>
    apiClient.PATCH('/api/v1/moderation/reports/{report_id}', {
      params: { path: { report_id: reportId } },
      body: payload,
    }),
  );
}
