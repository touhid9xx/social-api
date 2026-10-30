import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { IDEMPOTENCY_HEADER, idempotencyKey } from './idempotency';

/**
 * Follow-graph endpoints — the profile milestone (F11).
 *
 *   GET    /api/v1/users/{user_id}/follow-status  → FollowStatus
 *   GET    /api/v1/users/{user_id}/follow-counts  → FollowCounts
 *   GET    /api/v1/users/{user_id}/followers      → FollowListPage
 *   GET    /api/v1/users/{user_id}/following      → FollowListPage
 *   POST   /api/v1/follows/{user_id}              → 204 (idempotent)
 *   DELETE /api/v1/follows/{user_id}              → 204 (idempotent)
 *
 * `follow-status` is viewer-relative (`is_following`, `is_followed_by`,
 * `is_blocked_by_me`, `has_blocked_me`, `is_muted_by_me`) so it can never be
 * served from a shared cache: every call is authenticated and the answer
 * differs per reader. The hook therefore keys it on the viewer as well as the
 * target.
 *
 * Both writes answer `204 No Content`, so there is nothing to merge back into
 * the cache: `useToggleFollow` flips `is_following` and adjusts the counts
 * optimistically and lets the next read be the source of truth. `POST` is
 * idempotent at the HTTP layer and covered by the idempotency middleware, so it
 * carries a fresh key; `DELETE` needs none.
 *
 * `next_cursor` is OPAQUE and belongs in `pageParam`, never in a cache key (see
 * `./query-keys.ts`).
 */

export type FollowStatus = components['schemas']['FollowStatus'];

export type FollowCounts = components['schemas']['FollowCounts'];

export type FollowListPage = components['schemas']['FollowListPage'];

/** One row of a followers/following list. PII-free: no email reaches the client. */
export type FollowUser = FollowListPage['items'][number];

export type FollowListQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 100 (`le=100`); the contract wins, not the UI. */
  limit?: number;
};

export async function getFollowStatus(userId: number): Promise<FollowStatus> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}/follow-status', {
      params: { path: { user_id: userId } },
    }),
  );
}

export async function getFollowCounts(userId: number): Promise<FollowCounts> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}/follow-counts', {
      params: { path: { user_id: userId } },
    }),
  );
}

export async function getFollowers(
  userId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: FollowListQuery = {},
): Promise<FollowListPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}/followers', {
      params: { path: { user_id: userId }, query: { cursor, limit } },
    }),
  );
}

export async function getFollowing(
  userId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: FollowListQuery = {},
): Promise<FollowListPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}/following', {
      params: { path: { user_id: userId }, query: { cursor, limit } },
    }),
  );
}

export async function followUser(userId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.POST('/api/v1/follows/{user_id}', {
      params: { path: { user_id: userId } },
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}

export async function unfollowUser(userId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/follows/{user_id}', {
      params: { path: { user_id: userId } },
    }),
  );
}
