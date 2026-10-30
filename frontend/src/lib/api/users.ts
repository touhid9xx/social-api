import type { components } from '@/types/api';

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
