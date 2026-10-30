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
 * `GET /api/v1/posts/{post_id}` — [contracts/api_reference.md:2233] — is what the
 * detail route reads. It serialises the same `PostView` the feed does, so a card
 * and a detail page render from one type.
 *
 * `PATCH`/`DELETE` stay absent: `PostUpdate` requires `version` for the
 * optimistic lock, and the edit/delete UI is its own milestone.
 */

export type PostView = components['schemas']['PostView'];

/** Request body for `POST /api/v1/posts`. */
export type PostCreateBody = components['schemas']['PostCreate'];

export type PostVisibility = PostCreateBody['visibility'];

export async function getPost(postId: number): Promise<PostView> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/posts/{post_id}', {
      params: { path: { post_id: postId } },
    }),
  );
}

export async function createPost(input: PostCreateBody): Promise<PostView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/posts', {
      body: input,
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}
