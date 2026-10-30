import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';
import { IDEMPOTENCY_HEADER, idempotencyKey } from './idempotency';

/**
 * Chat — `src/social_api/modules/chat/router.py`.
 *
 * Four things about this API that the UI has to live with, pinned here so the
 * components do not rediscover them:
 *
 *  1. `GET /chat/rooms` returns a **bare array**, not a `{items, next_cursor}`
 *     envelope. The backend caps it at 100 rows, ordered newest-activity-first,
 *     and soft-deleted rooms are already excluded. There is no pagination to
 *     wire, so this is a plain `useQuery`, not an infinite one.
 *
 *  2. `RoomView` is `{id, type, title, created_at, updated_at}` — it carries
 *     **no participants and no last message**. A direct room has `title: null`,
 *     so the only way to name it is `GET /rooms/{id}/members` and pick the member
 *     who is not me. That is a second request per room and it is not optional.
 *
 *  3. `GET /rooms/{id}/messages` is **newest-first** (`order_by(created_at.desc(),
 *     id.desc())`). `next_cursor` therefore pages *backwards in time*, which is
 *     what "load older" means in a thread — the display order is reversed
 *     client-side, not the query.
 *
 *  4. `POST /rooms/{id}/messages` is covered by the idempotency middleware
 *     (`src/social_api/modules/idempotency/middleware.py:35`), so every send
 *     carries a fresh `Idempotency-Key`: a retried submit returns the FIRST
 *     message instead of posting it twice. It is also rate-limited to 30/min.
 *
 * `mark_read` is not a "set everything read" call — it takes an explicit
 * `message_id` and the backend rejects (`READ_RECEIPT_INVALID`, 400) an id that
 * is ahead of the room's latest or belongs to another room. Callers must send an
 * id they have actually seen in a page.
 *
 * `DELETE /chat/messages/{id}` is a soft delete, and a second delete answers 404
 * `MESSAGE_NOT_FOUND` (the row is filtered out by `deleted_at`), so it is
 * deliberately NOT retried.
 */

export type RoomView = components['schemas']['RoomView'];

/** `GET /chat/rooms` answers a bare array — see note 1. */
export type RoomList = RoomView[];

export type RoomMemberView = components['schemas']['RoomMemberView'];

export type RoomMembersList = components['schemas']['RoomMembersList'];

export type MessageView = components['schemas']['MessageView'];

export type MessagePage = components['schemas']['MessagePage'];

export type MemberReadState = components['schemas']['MemberReadState'];

export type ReadReceiptsList = components['schemas']['ReadReceiptsList'];

/** `{ unread }` — the chat and notification endpoints share this shape. */
export type ChatUnreadCount = components['schemas']['UnreadCount'];

export type MessageQuery = {
  /** Opaque cursor from the previous page. `null`/omitted asks for the newest. */
  cursor?: string | null;
  /** Backend caps this at 100 (`le=100`); the contract wins, not the UI. */
  limit?: number;
};

/** Every room the caller is a member of, newest activity first (cap 100). */
export async function getRooms(): Promise<RoomList> {
  return apiRequest(() => apiClient.GET('/api/v1/chat/rooms'));
}

export async function getRoom(roomId: number): Promise<RoomView> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/chat/rooms/{room_id}', {
      params: { path: { room_id: roomId } },
    }),
  );
}

/**
 * `POST /chat/rooms/direct` — find-or-create the 1:1 room with `otherUserId`.
 *
 * Idempotent by construction (the repo collapses the canonical `user_a < user_b`
 * pair under a UNIQUE constraint), so a double-click cannot open two rooms. It
 * answers 200, not 201, even when it created one.
 *
 * Fails `CANNOT_CHAT_WITH_SELF` (400) and `CHAT_BLOCKED` (403) when a block
 * exists in either direction.
 */
export async function startDirectRoom(otherUserId: number): Promise<RoomView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/chat/rooms/direct', {
      body: { other_user_id: otherUserId },
    }),
  );
}

export async function getRoomMembers(roomId: number): Promise<RoomMembersList> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/chat/rooms/{room_id}/members', {
      params: { path: { room_id: roomId } },
    }),
  );
}

/** One page of messages, newest-first. `next_cursor` asks for older messages. */
export async function getMessages(
  roomId: number,
  { cursor = null, limit = DEFAULT_PAGE_SIZE }: MessageQuery = {},
): Promise<MessagePage> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/chat/rooms/{room_id}/messages', {
      params: { path: { room_id: roomId }, query: { cursor, limit } },
    }),
  );
}

/**
 * `POST /chat/rooms/{room_id}/messages` → 201 `MessageView`.
 *
 * `media_id` is accepted by the contract but never sent from here: attachment
 * upload is the media milestone, and the backend rejects a foreign or already
 * attached media id (`MEDIA_NOT_OWNED` / `MEDIA_ALREADY_USED`).
 */
export async function sendMessage(roomId: number, body: string): Promise<MessageView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/chat/rooms/{room_id}/messages', {
      params: { path: { room_id: roomId } },
      body: { body },
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey() },
    }),
  );
}

/** 204. Not idempotent: the second delete answers 404 (see the header note). */
export async function deleteMessage(messageId: number): Promise<void> {
  await apiRequest(() =>
    apiClient.DELETE('/api/v1/chat/messages/{message_id}', {
      params: { path: { message_id: messageId } },
    }),
  );
}

/** Advance my read cursor to `messageId`, which must exist in this room. */
export async function markRead(roomId: number, messageId: number): Promise<MemberReadState> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/chat/rooms/{room_id}/read', {
      params: { path: { room_id: roomId } },
      body: { message_id: messageId },
    }),
  );
}

export async function getReadReceipts(roomId: number): Promise<ReadReceiptsList> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/chat/rooms/{room_id}/read-receipts', {
      params: { path: { room_id: roomId } },
    }),
  );
}

export async function getRoomUnreadCount(roomId: number): Promise<ChatUnreadCount> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/chat/rooms/{room_id}/unread-count', {
      params: { path: { room_id: roomId } },
    }),
  );
}
