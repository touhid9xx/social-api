'use client';

import { useQuery } from '@tanstack/react-query';

import { getUnreadCount, SOCIAL_SCOPE, type NotificationScope } from '@/lib/api/notifications';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/api/tokens';

/**
 * The unread badge count — deliberately its own query, not a derivation over
 * the inbox pages.
 *
 * The nav renders on every signed-in screen, but the inbox is only mounted on
 * `/notifications`. Counting unread rows from a list the user has not opened
 * would mean shipping the whole first page to render one number, and the count
 * would silently cap at the page size. `GET /notifications/unread-count`
 * answers exactly the question asked.
 *
 * The count is PER SCOPE. The nav badge asks for `social`, the same slice its
 * inbox shows, so a number on screen can always be cleared by opening the list
 * it points at; the staff alert screen counts `system` separately. Each scope is
 * its own cache entry (`queryKeys.notifications.unreadCount(scope)`), and the
 * `unreadCountRoot()` prefix invalidates all of them at once.
 *
 * `enabled` on an access token because the nav sits in the shell, outside the
 * session guard: without a token the request would be a guaranteed 401 on the
 * landing page and every sign-in screen.
 *
 * No polling. A `refetch` on focus keeps the number honest without a timer; live
 * changes arrive over the WebSocket bridge.
 */
export function useUnreadCount(scope: NotificationScope = SOCIAL_SCOPE) {
  const accessToken = useSessionStore((state) => state.accessToken);

  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(scope),
    queryFn: () => getUnreadCount(scope),
    enabled: Boolean(accessToken),
    refetchOnWindowFocus: true,
  });
}
