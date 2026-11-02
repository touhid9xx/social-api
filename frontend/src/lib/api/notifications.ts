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
 * Every kind the backend can emit. Kept as a union of literals (matching
 * `NotificationTypeLiteral`) so the UI's copy map is exhaustive: adding a type
 * on the server becomes a compile error here instead of a blank row.
 *
 * `admin_new_user` is the only staff-facing one — `notify_admins_new_user`
 * creates it for each admin when someone registers, with the new account as the
 * actor and `target_type="user"`, so an admin row links to the profile awaiting
 * review.
 */
export const NOTIFICATION_TYPES = [
  'follow',
  'like_post',
  'like_comment',
  'comment_post',
  'comment_reply',
  'admin_new_user',
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
  admin_new_user: 'types.adminNewUser',
};

/**
 * Which slice of the inbox a read or write applies to.
 *
 * `admin_new_user` is operational traffic aimed at staff, not social activity,
 * so it is deliberately excluded from the personal inbox: an admin should not
 * find "someone signed up" between a follow and a like. The backend owns that
 * split (`SYSTEM_NOTIFICATION_TYPES` in `notifications/models.py`) and exposes
 * it as a `scope` filter rather than a second table.
 *
 * `all` stays the server default so every other consumer can ignore this.
 */
export const NOTIFICATION_SCOPES = ['all', 'social', 'system'] as const;

export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];

/** The scope the personal inbox (`/notifications`) and its badge render. */
export const SOCIAL_SCOPE: NotificationScope = 'social';

/** The scope the staff alert screen (`/admin/system`) renders. */
export const SYSTEM_SCOPE: NotificationScope = 'system';

/**
 * The kinds that belong to the staff console rather than the personal inbox.
 *
 * Mirrors `SYSTEM_NOTIFICATION_TYPES` in `notifications/models.py` — the backend
 * is authoritative for *filtering*, but a pushed WebSocket row arrives with no
 * `scope` field, so the client has to classify it to know which cache entry to
 * prepend into. Keeping the list here means a new staff type is one edit, and
 * `scopeOf()` stays total because it is a `Record` over the union.
 */
export const SYSTEM_NOTIFICATION_TYPES = ['admin_new_user'] as const;

export type SystemNotificationType = (typeof SYSTEM_NOTIFICATION_TYPES)[number];

const NOTIFICATION_SCOPE_BY_TYPE: Record<NotificationType, NotificationScope> = {
  follow: SOCIAL_SCOPE,
  like_post: SOCIAL_SCOPE,
  like_comment: SOCIAL_SCOPE,
  comment_post: SOCIAL_SCOPE,
  comment_reply: SOCIAL_SCOPE,
  admin_new_user: SYSTEM_SCOPE,
};

/** Which inbox a notification of this kind lives in. */
export function scopeOfNotification(type: NotificationType): NotificationScope {
  return NOTIFICATION_SCOPE_BY_TYPE[type];
}

export type NotificationQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the first. */
  cursor?: string | null;
  /** Backend caps this at 50 (`le=50`); the contract wins, not the UI. */
  limit?: number;
  /** When true the backend skips read rows — used by the "Unread" filter. */
  unreadOnly?: boolean;
  /** Which slice to list: `all` (server default), `social`, or `system`. */
  scope?: NotificationScope;
};

export async function getNotifications({
  cursor = null,
  limit = DEFAULT_PAGE_SIZE,
  unreadOnly = false,
  scope = SOCIAL_SCOPE,
}: NotificationQuery = {}): Promise<NotificationPage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/notifications', {
      params: { query: { cursor, limit, unread_only: unreadOnly, scope } },
    }),
  );
}

export async function getUnreadCount(
  scope: NotificationScope = SOCIAL_SCOPE,
): Promise<UnreadCount> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/notifications/unread-count', { params: { query: { scope } } }),
  );
}

export async function markNotificationRead(notificationId: number): Promise<NotificationView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/notifications/{notif_id}/read', {
      params: { path: { notif_id: notificationId } },
    }),
  );
}

export async function markAllNotificationsRead(
  scope: NotificationScope = SOCIAL_SCOPE,
): Promise<MarkReadResponse> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/notifications/read-all', { params: { query: { scope } } }),
  );
}

export async function deleteNotification(notificationId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/notifications/{notif_id}', {
      params: { path: { notif_id: notificationId } },
    }),
  );
}
