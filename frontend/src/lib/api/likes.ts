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
