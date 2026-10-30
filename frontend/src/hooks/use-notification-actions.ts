'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The three notification writes, and why each reconciles differently.
 *
 * `markRead` — the response IS the updated row, so it is written straight into
 * the cache: replacing one item is exact, while invalidating the list would
 * refetch every page the user has scrolled and jump them back to the top. The
 * unread badge is invalidated, because `unread` is a number the client cannot
 * derive (it counts rows beyond the loaded pages).
 *
 * `markAllRead` — same reasoning inverted: the response only says HOW MANY rows
 * changed, not which ones, so every loaded page has to be rewritten from that
 * number (the first `updated` unread rows, matching the backend's oldest-first
 * ordering) and the list is invalidated afterwards so the next read agrees.
 *
 * `remove` — no body at all, so the row is dropped from every loaded page and
 * the badge is invalidated.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: number) => markNotificationRead(notificationId),

    onSuccess: (updated) => {
      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.notifications.all },
        (data: unknown) => replaceNotification(data, updated),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllNotificationsRead,

    onSuccess: ({ updated }) => {
      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.notifications.all },
        (data: unknown) => markFirstUnread(data, updated),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: number) => deleteNotification(notificationId),

    onSuccess: (_result, notificationId) => {
      queryClient.setQueriesData<unknown>(
        { queryKey: queryKeys.notifications.all },
        (data: unknown) => removeNotification(data, notificationId),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount() });
    },
  });
}

// ---------------------------------------------------------------------------
// Cache transforms. Written against `unknown` and narrowed by hand for the same
// reason `bumpPostCommentCount` is: `setQueriesData` runs over every cache
// entry under the prefix, and only some of them are infinite lists.
// ---------------------------------------------------------------------------

type WithPages = { pages?: unknown };
type PageLike = { items?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Map every loaded page's `items`, leaving non-list cache entries untouched. */
function mapItems(data: unknown, transform: (item: unknown) => unknown): unknown {
  const pages = (data as WithPages | null)?.pages;
  if (!Array.isArray(pages)) return data;

  return {
    ...(data as object),
    pages: pages.map((page: unknown) => {
      const items = (page as PageLike | null)?.items;
      if (!Array.isArray(items)) return page;

      return { ...(page as object), items: items.map(transform) };
    }),
  };
}

function replaceNotification(data: unknown, updated: { id: number }): unknown {
  return mapItems(data, (item) =>
    isRecord(item) && item.id === updated.id ? { ...item, ...updated } : item,
  );
}

function markFirstUnread(data: unknown, count: number): unknown {
  if (count <= 0) return data;
  let remaining = count;

  return mapItems(data, (item) => {
    if (remaining <= 0 || !isRecord(item) || item.is_read !== false) return item;
    remaining -= 1;
    return { ...item, is_read: true };
  });
}

function removeNotification(data: unknown, notificationId: number): unknown {
  const pages = (data as WithPages | null)?.pages;
  if (!Array.isArray(pages)) return data;

  return {
    ...(data as object),
    pages: pages.map((page: unknown) => {
      const items = (page as PageLike | null)?.items;
      if (!Array.isArray(items)) return page;

      return {
        ...(page as object),
        items: items.filter((item) => !(isRecord(item) && item.id === notificationId)),
      };
    }),
  };
}
