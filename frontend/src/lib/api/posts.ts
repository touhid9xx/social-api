import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { IDEMPOTENCY_HEADER, idempotencyKey } from './idempotency';

/**
 * `POST /api/v1/posts` — [contracts/api_reference.md:2167].
 *
 * `PostCreate` is `{ body: 1..5000 chars, visibility }` with `extra="forbid"`,
 * so the body is validated with the same bounds client-side
 * (`@/lib/validation/post`) before it ever leaves the browser.
 *
 * The endpoint is covered by the idempotency middleware
 * (`src/social_api/modules/idempotency/middleware.py:31`), so every create
 * carries a fresh `Idempotency-Key`: a retried submit returns the FIRST post
 * instead of publishing a duplicate.
 *
 * `PATCH`/`DELETE` are deliberately absent until the post-detail milestone —
 * `PostUpdate` requires `version` for the optimistic lock, which only a detail
 * view can supply.
 */

export type PostView = components['schemas']['PostView'];

/** Request body for `POST /api/v1/posts`. */
export type PostCreateBody = components['schemas']['PostCreate'];

export type PostVisibility = PostCreateBody['visibility'];

export async function createPost(input: PostCreateBody): Promise<PostView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/posts', {
      body: input,
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}
