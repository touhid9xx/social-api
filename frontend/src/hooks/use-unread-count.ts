'use client';

import { useQuery } from '@tanstack/react-query';

import { getUnreadCount } from '@/lib/api/notifications';
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
 * `enabled` on an access token because the nav sits in the shell, outside the
 * session guard: without a token the request would be a guaranteed 401 on the
 * landing page and every sign-in screen.
 *
 * No polling. There is a WebSocket module but no client yet (F16); a `refetch`
 * on focus keeps the number honest without a timer.
 */
export function useUnreadCount() {
  const accessToken = useSessionStore((state) => state.accessToken);

  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: getUnreadCount,
    enabled: Boolean(accessToken),
    refetchOnWindowFocus: true,
  });
}
