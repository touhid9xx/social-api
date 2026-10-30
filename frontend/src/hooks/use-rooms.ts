'use client';

import { useQuery } from '@tanstack/react-query';

import { getRoom, getRoomMembers, getRooms } from '@/lib/api/chat';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * The caller's conversation list.
 *
 * A plain `useQuery`, NOT an infinite one: `GET /chat/rooms` answers a bare
 * array with no `next_cursor`, capped server-side at 100 rows and already
 * ordered newest-activity-first. Nothing to page, so nothing to page with.
 *
 * `staleTime` is short (10s) because the ordering is "most recent message first"
 * — a room that just received a message belongs at the top, and a list that sat
 * on screen through several navigations should not still claim otherwise. Sends
 * invalidate this key explicitly (see `use-chat-actions`), so this only catches
 * the changes other tabs and people cause.
 */
export function useRooms() {
  return useQuery({
    queryKey: queryKeys.chat.rooms(),
    queryFn: getRooms,
    staleTime: 10_000,
  });
}

/** One room's `{id, type, title, …}` — no participants, no last message. */
export function useRoom(roomId: number) {
  return useQuery({
    queryKey: queryKeys.chat.room(roomId),
    queryFn: () => getRoom(roomId),
  });
}

/**
 * Who is in the room.
 *
 * This is not decoration: `RoomView` has no participant field and a direct room
 * has `title: null`, so the peer is *only* discoverable here — the member whose
 * `user_id` is not mine. The thread header and the room list both depend on it.
 *
 * It also carries `role` and `last_read_message_id`, which is what "Seen" is
 * derived from in a direct chat.
 */
export function useRoomMembers(roomId: number) {
  return useQuery({
    queryKey: queryKeys.chat.members(roomId),
    queryFn: () => getRoomMembers(roomId),
  });
}
