import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { IDEMPOTENCY_HEADER, idempotencyKey } from './idempotency';

/**
 * Comment endpoints — [contracts/api_reference.md:909] (`POST`) and
 * [:947] (`GET`).
 *
 * `GET /api/v1/posts/{post_id}/comments` pages the TOP-LEVEL comments only and
 * serialises each one's first replies inline as `replies`, so a thread is at
 * most two levels deep (`MAX_COMMENT_DEPTH = 2` in
 * `src/social_api/modules/comments/models.py`). A reply to a reply is a real
 * `COMMENT_DEPTH_EXCEEDED` from the backend, which is why the UI only offers
 * "Reply" on top-level comments.
 *
 * `next_cursor` is OPAQUE and belongs in `pageParam`, never in a cache key
 * (see `./query-keys.ts`).
 *
 * `POST` is covered by the idempotency middleware
 * (`^/api/v1/posts/\d+/comments$`, `src/social_api/modules/idempotency/
 * middleware.py:32`), so a create carries a fresh `Idempotency-Key`: a retried
 * submit returns the FIRST comment instead of posting twice.
 *
 * `PATCH`/`DELETE` need the `version` the list does not serialise, so they wait
 * for the comment-editing milestone.
 */

export type CommentView = components['schemas']['CommentView'];

export type CommentPage = components['schemas']['CommentPage'];

/** Request body for `POST /api/v1/posts/{post_id}/comments`. */
export type CommentCreateBody = components['schemas']['CommentCreate'];

export type CommentQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 100 (`le=100`); the contract wins, not the UI. */
  limit?: number;
};

export async function getPostComments(
  postId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: CommentQuery = {},
): Promise<CommentPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/posts/{post_id}/comments', {
      params: { path: { post_id: postId }, query: { cursor, limit } },
    }),
  );
}

export async function createComment(
  postId: number,
  input: CommentCreateBody,
): Promise<CommentView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/posts/{post_id}/comments', {
      params: { path: { post_id: postId } },
      body: input,
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}
