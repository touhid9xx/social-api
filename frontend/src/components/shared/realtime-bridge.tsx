'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useWsEvent } from '@/hooks/use-websocket';
import { NOTIFICATION_COPY_KEYS, type NotificationView } from '@/lib/api/notifications';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The consumer the F15 socket was built for (F16).
 *
 * `WebSocketProvider` owns exactly one connection per tab and deliberately
 * handles no events itself; this component is the single subscriber that turns
 * a frame into a cache write. It renders nothing.
 *
 * Routing is by the envelope, then by `kind` — the backend reuses the
 * `notification` envelope type for three unrelated payloads
 * (`src/social_api/realtime/events.py`):
 *
 *  - `kind: "chat_message"`   — `ChatService._publish_message_event`, sent to the
 *    room's other members. The message body is ignored on purpose: the chat
 *    thread owns its own pagination (`flattenNewestFirst`), and splicing a
 *    second writer into that list would fight `next_cursor`. Invalidating the
 *    room's queries is enough, and an unmounted room refetches nothing.
 *  - `kind: "report_resolved"`— `ModerationService._notify_reporter`, sent to the
 *    reporter only. Nothing is cached that this would change, so it is purely a
 *    toast.
 *  - no `kind`                — a real `NotificationView` row, which IS cache
 *    data and gets written straight in.
 *
 * Two deliberate non-decisions:
 *
 *  1. The inbox row is **prepended**, not invalidated. `invalidateQueries` on an
 *     infinite query refetches every page the user has already scrolled, which
 *     both costs N requests and jumps them to the top — the same reasoning that
 *     drives `useMarkNotificationRead`.
 *  2. `unread_delta` is **never** applied arithmetically. `unread` counts rows
 *     beyond the loaded pages, so the client cannot derive it; and the mark-read
 *     mutation already invalidates the same key, so a delta here plus a refetch
 *     there would race and drift. An invalidation converges on the truth.
 *
 * (নোটিফিকেশন এলে cache-এ সরাসরি বসাই; badge-টা refetch করি, যোগ-বিয়োগ করি না।)
 */

/**
 * The two terminal statuses `_notify_reporter` can push, mapped to the copy the
 * admin queue already uses. Anything else falls back to a description-less
 * toast rather than printing a raw enum at the user.
 */
const REPORT_STATUS_COPY_KEYS: Record<string, string> = {
  resolved: 'admin.reports.status.resolved',
  dismissed: 'admin.reports.status.dismissed',
};

type WithPages = { pages?: unknown };
type PageLike = { items?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Put a pushed row on top of the first cached inbox page.
 *
 * Returns `data` untouched when the entry under this key is not an infinite
 * list — `setQueriesData` with the `notifications` prefix also visits the
 * `unread-count` query, which is a bare object — and when the row is already
 * cached: the server de-duplicates per day, so a replay is not expected, but a
 * duplicate row in a keyed list is a React warning nobody needs.
 */
function prependNotification(data: unknown, notification: NotificationView): unknown {
  const pages = (data as WithPages | null)?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return data;

  const first = pages[0] as PageLike | null;
  const items = first?.items;
  if (!Array.isArray(items)) return data;
  if (items.some((item) => isRecord(item) && item.id === notification.id)) return data;

  return {
    ...(data as object),
    pages: [{ ...(first as object), items: [notification, ...items] }, ...pages.slice(1)],
  };
}

export function RealtimeBridge() {
  const queryClient = useQueryClient();
  const t = useTranslations('realtime');
  const tRoot = useTranslations();

  useWsEvent('notification', (event) => {
    // Narrowed on the discriminant directly, not through an alias and not with
    // `'kind' in data`: the inbox variant declares `kind` as `undefined`, and only
    // a direct comparison collapses the union (the `in` guard cannot, because the
    // `.passthrough()` index signature types `kind` as `unknown` there).
    const data = event.data;

    if (data.kind === undefined) {
      // `cached` is annotated because `setQueriesData`'s updater parameter does
      // not resolve from the generic here (same shape as `use-room-live`).
      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.notifications.all },
        (cached: unknown) => prependNotification(cached, data),
      );

      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });

      // The frame carries `actor_id`, not a name, and firing a profile request per
      // notification would be worse than the fallback the inbox already shows.
      const name = tRoot('notifications.actorFallback', { id: data.actor_id });
      toast.message(t('newNotification'), {
        description: tRoot(`notifications.${NOTIFICATION_COPY_KEYS[data.type]}`, { name }),
      });
      return;
    }

    if (data.kind === 'chat_message') {
      // `refetchType: 'none'` on purpose: the room the reader is *looking at*
      // has already patched this frame into its cache from its own room
      // subscription (`use-room-live`), and refetching would throw away every
      // older page they scrolled back through. The key is still marked stale,
      // so a room that is closed right now revalidates on its next mount.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chat.messages(data.room_id),
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() });
      return;
    }

    // Any other `kind`-tagged frame: a report outcome is a toast only, because
    // nothing it would change lives in the cache.
    if (data.kind === 'report_resolved') {
      const statusKey = REPORT_STATUS_COPY_KEYS[data.status];
      toast.message(t('reportResolved'), {
        description: statusKey ? tRoot(statusKey) : undefined,
      });
    }
  });

  useWsEvent('unread_count', (event) => {
    const { unread } = event.data;
    const key = queryKeys.notifications.unreadCount();

    if (typeof unread === 'number') {
      // Authoritative after `mark_all_read` — the only absolute the server sends.
      queryClient.setQueryData(key, { unread });
      return;
    }

    if (typeof event.data.unread_delta === 'number') {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });

  return null;
}
