import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Notification inbox — [contracts/api_reference.md:2011].
 *
 * Five endpoints, and the split matters:
 *  - `GET  /notifications`               cursor-paginated inbox;
 *  - `GET  /notifications/unread-count`  `{ unread }`, the only thing the nav
 *                                        badge needs, so the badge never
 *                                        fetches a page of rows;
 *  - `POST /notifications/{id}/read`     returns the updated `NotificationView`;
 *  - `POST /notifications/read-all`      returns `{ updated }`, the number of
 *                                        rows it actually flipped (0 is a normal
 *                                        answer, not an error);
 *  - `DELETE /notifications/{id}`        204, no body.
 *
 * `next_cursor` is OPAQUE and belongs in `pageParam`, never in a cache key
 * (see `./query-keys.ts`).
 *
 * None of these are `Idempotency-Key` routes: marking a notification read twice
 * has no additional effect, and the backend middleware does not guard them.
 */

export type NotificationView = components['schemas']['NotificationView'];

export type NotificationPage = components['schemas']['NotificationPage'];

export type UnreadCount = components['schemas']['UnreadCount'];

export type MarkReadResponse = components['schemas']['MarkReadResponse'];

/**
 * The five kinds the backend can emit. Kept as a union of literals (matching
 * `NotificationTypeLiteral`) so the UI's copy map is exhaustive: adding a type
 * on the server becomes a compile error here instead of a blank row.
 */
export const NOTIFICATION_TYPES = [
  'follow',
  'like_post',
  'like_comment',
  'comment_post',
  'comment_reply',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The `notifications.types.*` key that says what each kind means, relative to
 * the `notifications` namespace.
 *
 * Lives here rather than in a component because two places now render the same
 * sentence — an inbox row, and the toast the WebSocket bridge fires when a row
 * arrives while the user is elsewhere. A `Record` over the union keeps it total:
 * a new server-side type breaks the build instead of toasting nothing.
 */
export const NOTIFICATION_COPY_KEYS: Record<NotificationType, string> = {
  follow: 'types.follow',
  like_post: 'types.likePost',
  like_comment: 'types.likeComment',
  comment_post: 'types.commentPost',
  comment_reply: 'types.commentReply',
};

export type NotificationQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 50 (`le=50`); the contract wins, not the UI. */
  limit?: number;
  /** When true the backend skips read rows — used by the "Unread" filter. */
  unreadOnly?: boolean;
};

export async function getNotifications({
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
  unreadOnly = false,
}: NotificationQuery = {}): Promise<NotificationPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/notifications', {
      params: { query: { cursor, limit, unread_only: unreadOnly } },
    }),
  );
}

export async function getUnreadCount(): Promise<UnreadCount> {
  return apiRequest(() => apiClient.GET('/api/v1/notifications/unread-count'));
}

export async function markNotificationRead(notificationId: number): Promise<NotificationView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/notifications/{notif_id}/read', {
      params: { path: { notif_id: notificationId } },
    }),
  );
}

export async function markAllNotificationsRead(): Promise<MarkReadResponse> {
  return apiRequest(() => apiClient.POST('/api/v1/notifications/read-all'));
}

export async function deleteNotification(notificationId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/notifications/{notif_id}', {
      params: { path: { notif_id: notificationId } },
    }),
  );
}
