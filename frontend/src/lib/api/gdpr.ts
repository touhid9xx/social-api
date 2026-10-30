import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * GDPR endpoints — right of access (export) and the deletion grace window.
 *
 * `DELETE /api/v1/users/me` also schedules a deletion, but it lives in
 * `./users` because it is a `/users` route; this module owns the three
 * `/gdpr` paths that read or amend that schedule.
 *
 * Two of the three deliberately run on `get_current_user_allow_deleted`
 * (`src/social_api/modules/gdpr/router.py`): once an account is soft-deleted the
 * normal dependency 401s, so cancellation and status would be unreachable with
 * an ordinary token. The client does not special-case this — it just calls them
 * while the access token is still live, which is the only window where a user
 * can change their mind.
 */

export type DeletionStatus = components['schemas']['DeletionStatusView'];

export type CancelDeletionResponse = components['schemas']['CancelResponse'];

/** What `GET /gdpr/deletion-status` reports. `status` is a plain string, not an enum. */
export type DeletionState = DeletionStatus['status'];

/**
 * `GET /api/v1/gdpr/deletion-status` — [contracts/api_reference.md:498].
 *
 * `status` is one of `scheduled | completed | cancelled | none`. Only
 * `scheduled` has a live `scheduled_hard_delete_at`; the other states leave it
 * null, so the UI must not read the timestamp without checking `scheduled`.
 */
export async function getDeletionStatus(): Promise<DeletionStatus> {
  return apiRequest(() => apiClient.GET('/api/v1/gdpr/deletion-status'));
}

/**
 * `POST /api/v1/gdpr/cancel-delete` — undo a pending deletion.
 *
 * Answers `NO_ACTIVE_DELETION` (already mapped to `errors.noActiveDeletion`) when
 * there is nothing to cancel, which is a real state and not a client bug: the
 * window may have closed between the status read and the click.
 */
export async function cancelDeletion(): Promise<CancelDeletionResponse> {
  return apiRequest(() => apiClient.POST('/api/v1/gdpr/cancel-delete'));
}

/**
 * `GET /api/v1/gdpr/export` — full data dump as JSON.
 *
 * The handler returns a `Content-Disposition: attachment` response with an
 * `unknown` schema, so there is nothing to model on the wire: the caller turns
 * the value straight into a file. Rate-limited to **1/minute** because it joins
 * every table the user touches — the UI disables the control while it runs
 * rather than letting the user discover the 429.
 */
export async function exportMyData(): Promise<unknown> {
  return apiRequest(() => apiClient.GET('/api/v1/gdpr/export'));
}
