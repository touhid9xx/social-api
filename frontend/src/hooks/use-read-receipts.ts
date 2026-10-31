'use client';

import { useQuery } from '@tanstack/react-query';

import { getReadReceipts } from '@/lib/api/chat';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * Who has read how far in one room — `GET /chat/rooms/{id}/read-receipts`.
 *
 * This is a SEPARATE document from the members list: `RoomMemberView` carries
 * `{user_id, role, joined_at}` only, so "Seen" cannot be derived from
 * `useRoomMembers` and must be fetched here.
 *
 * `staleTime` is 30s, not 0: the watermark only moves when the other person
 * reads, and there is no read-receipt frame on the socket (the WS contract has
 * `chat_message`, presence and `unread_count` — no receipts). Refetching on every
 * thread frame would spend a request to learn nothing. The trade is deliberate:
 * a "Seen" that lags by up to half a minute beats a request per keystroke.
 *
 * `enabled` is `false` for rooms we cannot see; the caller passes `undefined`
 * for a group, where a single watermark would be meaningless.
 */
export function useReadReceipts(roomId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.chat.readReceipts(roomId ?? 0),
    queryFn: () => getReadReceipts(roomId as number),
    enabled: roomId !== undefined,
    staleTime: 30_000,
  });
}
