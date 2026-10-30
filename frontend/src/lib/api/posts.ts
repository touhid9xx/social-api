import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
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

/** One page of `GET /api/v1/posts/by-author/{author_id}`. */
export type PostPage = components['schemas']['PostPage'];

export type AuthorPostQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 100 (`le=100`); the contract wins, not the UI. */
  limit?: number;
};

export async function getPost(postId: number): Promise<PostView> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/posts/{post_id}', {
      params: { path: { post_id: postId } },
    }),
  );
}

/**
 * `GET /api/v1/posts/by-author/{author_id}` — the profile's post list.
 *
 * Returns the same `PostView` the feeds do, so `PostFeed` renders it unchanged:
 * `PostPage` and `FeedPage` are structurally identical (`items` + `next_cursor`).
 * Visibility is enforced server-side, so a stranger's private posts simply are
 * not in the page rather than being filtered here.
 */
export async function getAuthorPosts(
  authorId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: AuthorPostQuery = {},
): Promise<PostPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/posts/by-author/{author_id}', {
      params: { path: { author_id: authorId }, query: { cursor, limit } },
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
