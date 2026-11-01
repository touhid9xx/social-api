import type { components } from '@/types/api';

import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

import { apiClient, apiRequest } from './client';

/**
 * `GET /api/v1/users/{user_id}` — [contracts/api_reference.md:2546].
 *
 * The feed's `PostView` carries `author_id` only (no nested author object), so
 * every card resolves its own author through this endpoint. TanStack Query
 * dedupes by `queryKeys.users.profile(id)`, so a page of posts by the same
 * author costs one request, and scrolling back costs none.
 */

export type PublicProfile = components['schemas']['ProfilePublic'];

/** The owner's own profile — carries PII the public endpoint hides. */
export type SelfProfile = components['schemas']['ProfileSelf'];

export async function getProfile(userId: number): Promise<PublicProfile> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}', {
      params: { path: { user_id: userId } },
    }),
  );
}

/**
 * `GET /api/v1/users/me` — [contracts/api_reference.md:2376].
 *
 * Separate from `getProfile` because it answers a different question and a
 * different shape: `ProfileSelf` includes the caller's own PII (phone, address,
 * dob) and its optimistic-lock `version`. Keep it out of anything that renders a
 * public profile, and never let one type stand in for the other — the public
 * serializer deliberately drops the fields this one has.
 *
 * The profile screen uses it for one decision: whether the follow button belongs
 * on this page at all. The backend answers `CANNOT_FOLLOW_SELF` to a self-follow,
 * so asking is cheaper than rendering a control that can only fail.
 */
export async function getMe(): Promise<SelfProfile> {
  return apiRequest(() => apiClient.GET('/api/v1/users/me'));
}

/** PATCH body. `version` is required — the backend locks optimistically. */
export type ProfileUpdate = components['schemas']['ProfileUpdate'];

export type ConsentChannel = components['schemas']['ConsentRecord']['channel'];

/**
 * Every channel the backend can record, in the order the settings screen lists
 * them (`ConsentChannel` in `src/social_api/modules/users/models.py`).
 *
 * Derived from the contract rather than the response: `GET /users/me/consent`
 * omits channels the user has never acted on, so the switch list cannot be built
 * from what came back — only from what the enum allows.
 */
export const CONSENT_CHANNELS = [
  'email_marketing',
  'sms_marketing',
  'analytics',
  'product_updates',
] as const satisfies readonly ConsentChannel[];

export type ConsentRecord = components['schemas']['ConsentRecord'];

export type DeleteMeResponse = components['schemas']['DeleteMeResponse'];

/**
 * `PATCH /api/v1/users/me` — [contracts/api_reference.md:2397].
 *
 * Two contract details drive the call shape:
 *
 *  1. `version` is part of the BODY and is mandatory, even though every other
 *     field is optional. Sending the version we last read is what makes a lost
 *     update fail loudly (`VERSION_CONFLICT`, already mapped to
 *     `errors.versionConflict`) instead of silently overwriting a change made on
 *     another device.
 *  2. The model forbids unknown keys (`extra="forbid"`), so the caller must send
 *     only fields it actually means to change — see `toProfileUpdate`.
 *
 * The response is the FULL new `ProfileSelf`, including the bumped `version`, so
 * the caller writes it straight into the cache rather than refetching.
 */
export async function updateMe(payload: ProfileUpdate): Promise<SelfProfile> {
  return apiRequest(() => apiClient.PATCH('/api/v1/users/me', { body: payload }));
}

/**
 * `GET /api/v1/users/me/consent` — [contracts/api_reference.md:2452].
 *
 * Only channels the user has ever acted on come back, so a channel missing from
 * the list has never been granted. The UI treats absent as "off" rather than
 * assuming the backend materialises all four.
 */
export async function getConsents(): Promise<ConsentRecord[]> {
  const data = await apiRequest(() => apiClient.GET('/api/v1/users/me/consent'));
  return data.consents;
}

/**
 * `POST /api/v1/users/me/consent` — answers 201 with an informational message.
 *
 * The backend records the client IP and user-agent alongside the grant (that is
 * the audit trail GDPR wants), which is exactly why the caller must not fake the
 * consent locally: the row is evidence, so it has to come from the server.
 */
export async function grantConsent(channel: ConsentChannel): Promise<void> {
  await apiRequest(() => apiClient.POST('/api/v1/users/me/consent', { body: { channel } }));
}

/** `DELETE /api/v1/users/me/consent/{channel}` — 204, no body. */
export async function revokeConsent(channel: ConsentChannel): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/users/me/consent/{channel}', {
      params: { path: { channel } },
    }),
  );
}

/**
 * `DELETE /api/v1/users/me` — soft-delete + schedule the hard delete.
 *
 * The handler does both in one transaction: it soft-deletes the account and
 * schedules the GDPR hard delete, suppressing `ALREADY_SCHEDULED_FOR_DELETION`
 * on a repeat call. The response carries `hard_delete_after`, which is the only
 * piece of information the UI cannot derive — the exact end of the grace window.
 */
export async function deleteMe(): Promise<DeleteMeResponse> {
  return apiRequest(() => apiClient.DELETE('/api/v1/users/me'));
}

/** One row of the staff-only directory. Same PII posture as `UserPublic`. */
export type AdminUserView = components['schemas']['AdminUserView'];

export type AdminUserPage = components['schemas']['AdminUserPage'];

export type AdminUserQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  limit?: number;
};

/**
 * `GET /api/v1/users` — the staff-only account directory.
 *
 * Three things make this a different call from `getProfile`:
 *
 *  1. It is admin-only (`require_roles(ADMIN)`), so a non-admin gets a plain
 *     `403 FORBIDDEN`. That is a normal outcome, not a bug: the client cannot
 *     pre-check the role (the role arrives with the token, and the server stays
 *     the authority), so the caller must render 403 as "admins only" rather
 *     than as an empty directory.
 *  2. It carries `display_name` and `avatar_url` itself — the same convenience
 *     `FollowUserView` offers — so a row must NOT resolve an author through
 *     `/users/{id}`. That would be one request per row for data already in hand.
 *  3. It exposes no email and no phone: the encrypted columns stay encrypted and
 *     unexposed, exactly like `UserPublic`.
 *
 * Keyset-paginated on `(created_at DESC, id DESC)` server-side, so a page is
 * stable for the caller but may shift under it when someone signs up — the list
 * dedupes by `id`, same as the follow lists.
 */
export async function getAdminUsers({
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
}: AdminUserQuery = {}): Promise<AdminUserPage> {
  return apiRequest(() => apiClient.GET('/api/v1/users', { params: { query: { cursor, limit } } }));
}

/** PATCH body for one account. Only the keys actually sent are applied. */
export type AdminUserUpdate = components['schemas']['AdminUserUpdate'];

/**
 * `PATCH /api/v1/users/{user_id}` — change another account's role or flags.
 *
 * Same body discipline as `updateMe`: the model forbids unknown keys and the
 * service applies `exclude_unset`, so sending `{ is_active: true }` leaves the
 * role alone. A `null` counts as "not sent" too (`exclude_none`), so a caller can
 * spread an optional form field without risking a NULL write. Callers therefore
 * build the body from what changed, never from a whole form snapshot.
 *
 * The response is the full re-read `AdminUserView` — identical in shape to a
 * directory row, so the list can patch one entry in place instead of refetching
 * page one and losing the reader's scroll position.
 */
export async function updateAdminUser(
  userId: number,
  payload: AdminUserUpdate,
): Promise<AdminUserView> {
  return apiRequest(() =>
    apiClient.PATCH('/api/v1/users/{user_id}', {
      params: { path: { user_id: userId } },
      body: payload,
    }),
  );
}

/**
 * `POST /api/v1/users/{user_id}/activate` — clear the sign-in block.
 *
 * Sets `is_active` AND `is_verified` in one call. The two are separate columns
 * but one intent here: this is the manual stand-in for the emailed verification
 * link, so an admin can admit an account on a deployment with no mail server.
 * That is why it is a named endpoint rather than `PATCH { is_active: true }` —
 * the pairing is the policy, and it should not be reassembled per caller.
 */
export async function activateAdminUser(userId: number): Promise<AdminUserView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/users/{user_id}/activate', {
      params: { path: { user_id: userId } },
    }),
  );
}

/**
 * `DELETE /api/v1/users/{user_id}` — soft-delete another account.
 *
 * Not a hard delete, and not the same operation as `DELETE /users/me`: this one
 * only flips `deleted_at` + `is_active` and writes an audit row. It schedules no
 * GDPR hard delete, so it stays reversible — an admin reinstating the account is
 * `activate` on the same id.
 *
 * The response is the final row rather than `204`, so the console can show the
 * resulting state (deactivated, still listed) without guessing what the server
 * did. The directory filters out deleted accounts, so the row leaves the list on
 * the next refetch.
 */
export async function deleteAdminUser(userId: number): Promise<AdminUserView> {
  return apiRequest(() =>
    apiClient.DELETE('/api/v1/users/{user_id}', { params: { path: { user_id: userId } } }),
  );
}
