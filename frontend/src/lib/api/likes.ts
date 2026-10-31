import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { IDEMPOTENCY_HEADER, idempotencyKey } from './idempotency';

/**
 * `POST|DELETE /api/v1/likes/{target_type}/{target_id}`
 * — [contracts/api_reference.md:1665].
 *
 * Both return `204 No Content`, so there is no body to merge back into the
 * cache: the like count and `is_liked_by_me` are updated optimistically and the
 * next feed read is the source of truth.
 *
 * The backend accepts only `post` and `comment` (it answers
 * `BAD_REQUEST` otherwise), so the type is a union rather than `string` — the
 * compiler stops a typo here instead of at runtime.
 *
 * `POST` is idempotent at the HTTP layer (`like` is a no-op when the row already
 * exists and the middleware pattern covers it), `DELETE` needs no key.
 */

export const LIKE_TARGET_TYPES = ['post', 'comment'] as const;

export type LikeTargetType = (typeof LIKE_TARGET_TYPES)[number];

export async function likeTarget(targetType: LikeTargetType, targetId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.POST('/api/v1/likes/{target_type}/{target_id}', {
      params: { path: { target_type: targetType, target_id: targetId } },
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}

export async function unlikeTarget(targetType: LikeTargetType, targetId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/likes/{target_type}/{target_id}', {
      params: { path: { target_type: targetType, target_id: targetId } },
    }),
  );
}

export type LikeUser = components['schemas']['LikeUser'];

export type LikeUserPage = components['schemas']['LikeUserPage'];

export type LikersQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** The backend caps this at 100 (`le=100`), and `limit` is the page size. */
  limit?: number;
};

/**
 * `GET /api/v1/likes/{target_type}/{target_id}/users`
 * — [contracts/api_reference.md:1733].
 *
 * The read side of a like: who is in the set, newest like first, cursor-paged.
 * `LikeUser` carries `display_name` and `avatar_url` inline, so the dialog needs
 * no follow-up profile read per row (`FollowListPage` made the same choice).
 *
 * Three facts about this endpoint that shape the UI:
 *
 *  1. It does NOT check that the target exists. An unknown id answers `200` with
 *     an empty page, so "no likes" and "no such post" are indistinguishable here
 *     — the dialog must not claim the post exists, only that nobody is listed.
 *  2. An unknown `target_type` is also an empty page, not a `400`: the router
 *     takes a plain `str` (`router.py:65`) and the repository simply matches no
 *     rows. The union on `LikeTargetType` is therefore the frontend's guard, and
 *     the only one.
 *  3. There is no visibility filter — any authenticated caller sees the full set
 *     for any post or comment. Reading a private post's like list is not
 *     blocked *here*; the dialog is only ever opened from a card the viewer was
 *     already allowed to read.
 */
export async function getLikers(
  targetType: LikeTargetType,
  targetId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: LikersQuery = {},
): Promise<LikeUserPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/likes/{target_type}/{target_id}/users', {
      params: {
        path: { target_type: targetType, target_id: targetId },
        query: { cursor, limit },
      },
    }),
  );
}
