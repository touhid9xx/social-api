'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteMessage, markRead, sendMessage, startDirectRoom } from '@/lib/api/chat';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The chat writes, and how each one reconciles the cache.
 *
 * `send` — the 201 body IS the stored message, so it is PREPENDED to page 0 of
 * the thread instead of invalidating it. Invalidating would refetch every page
 * the user has scrolled back through and drop them where they started; the row
 * is known exactly, and pages are newest-first, so head-of-page-0 is where it
 * belongs. The rooms list is invalidated because `updated_at` moved and the
 * ordering ("latest activity first") is the server's to decide.
 *
 * `remove` — 204, no body. The message is soft-deleted server-side, so a refetch
 * would also stop returning it; dropping it by id from every loaded page is the
 * same answer without the round trip.
 *
 * `markRead` — the response only reports MY new watermark. The per-room unread
 * count is not derivable on the client (it counts rows that may be older than
 * the loaded pages), so that key is invalidated rather than guessed at.
 *
 * No optimistic writes anywhere: sends are rate-limited (30/min) and idempotency
 * keyed, so a rejected send must not leave an invented bubble on screen, and a
 * retried one must not produce two.
 */

type SendVars = { roomId: number; body: string };
type DeleteVars = { roomId: number; messageId: number };
type ReadVars = { roomId: number; messageId: number };

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roomId, body }: SendVars) => sendMessage(roomId, body),

    onSuccess: (created, { roomId }) => {
      queryClient.setQueryData<unknown>(queryKeys.chat.messages(roomId), (data: unknown) =>
        prependMessage(data, created),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() });
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId }: DeleteVars) => deleteMessage(messageId),

    onSuccess: (_result, { roomId, messageId }) => {
      queryClient.setQueryData<unknown>(queryKeys.chat.messages(roomId), (data: unknown) =>
        removeMessage(data, messageId),
      );
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roomId, messageId }: ReadVars) => markRead(roomId, messageId),

    onSuccess: (_state, { roomId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.unreadCount(roomId) });
    },
  });
}

/**
 * Find-or-create the 1:1 room with someone, then hand the room back so the
 * caller can navigate into it.
 *
 * The rooms list is invalidated on success: whether this created a room or
 * returned an existing one, the pair now has a conversation that belongs in the
 * list.
 */
export function useStartDirectRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (otherUserId: number) => startDirectRoom(otherUserId),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.rooms() });
    },
  });
}

// ---------------------------------------------------------------------------
// Cache transforms. Narrowed by hand against `unknown` because an infinite
// query's cached value is `{ pages, pageParams }`, not a list — same approach as
// `use-notification-actions`.
// ---------------------------------------------------------------------------

type WithPages = { pages?: unknown };
type PageLike = { items?: unknown };

function withPages(data: unknown, transform: (items: unknown[]) => unknown[]): unknown {
  const pages = (data as WithPages | null)?.pages;
  if (!Array.isArray(pages)) return data;

  return {
    ...(data as object),
    pages: pages.map((page: unknown) => {
      const items = (page as PageLike | null)?.items;
      if (!Array.isArray(items)) return page;

      return { ...(page as object), items: transform(items) };
    }),
  };
}

/**
 * Newest-first pages, so a new message belongs at the head of the FIRST page.
 *
 * Exported because the live-room subscription (`use-room-live`) has to patch a
 * pushed message into the same cache shape the send mutation patches — two
 * copies of this insertion rule would drift.
 */
export function prependMessage(data: unknown, created: { id: number }): unknown {
  const pages = (data as WithPages | null)?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return data;

  // Skip a duplicate: a retried send (same Idempotency-Key) returns the message
  // the server already stored, and the cache may have been patched from the
  // first response.
  const alreadyThere = pages.some((page: unknown) => {
    const items = (page as PageLike | null)?.items;
    return (
      Array.isArray(items) &&
      items.some((item) => (item as { id?: unknown } | null)?.id === created.id)
    );
  });
  if (alreadyThere) return data;

  return {
    ...(data as object),
    pages: [pages[0], ...pages.slice(1)].map((page: unknown, index: number) => {
      const items = (page as PageLike | null)?.items;
      if (!Array.isArray(items)) return page;

      return {
        ...(page as object),
        items: index === 0 ? [created, ...items] : items,
      };
    }),
  };
}

function removeMessage(data: unknown, messageId: number): unknown {
  return withPages(data, (items) =>
    items.filter((item) => (item as { id?: unknown } | null)?.id !== messageId),
  );
}
