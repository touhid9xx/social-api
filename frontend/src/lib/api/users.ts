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

export async function getProfile(userId: number): Promise<PublicProfile> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/users/{user_id}', {
      params: { path: { user_id: userId } },
    }),
  );
}
