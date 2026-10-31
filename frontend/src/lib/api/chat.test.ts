import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { adminUser, chatRooms, groupRoom, roomMembers, roomReadState } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import {
  deleteMessage,
  getMessages,
  getReadReceipts,
  getRoom,
  getRoomMembers,
  getRoomUnreadCount,
  getRooms,
  markRead,
  sendMessage,
  startDirectRoom,
} from './chat';
import { AppApiError } from './errors';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
} from './idempotency';

/**
 * The chat client.
 *
 * The four contract quirks `chat.ts` documents are the four things worth pinning
 * here, because each of them is a place a plausible-looking client would be wrong:
 *
 *  - `GET /chat/rooms` is a **bare array**, not a `{items, next_cursor}` envelope,
 *    so any generic "unwrap the envelope" helper would mangle it;
 *  - the first message page sends **no cursor** (a `null` reaching the backend as
 *    the literal string "null" would 422), while an opaque cursor round-trips
 *    untouched;
 *  - every send carries a **fresh** `Idempotency-Key`, which is what makes a
 *    retried submit return the first message instead of posting a second one;
 *  - the read watermark lives on the **read-receipts document**, keyed by member,
 *    and may legitimately be `null` for someone who has not read anything yet.
 *
 * (প্রথম পাতায় cursor যায় না; প্রতি পাঠে নতুন idempotency key যায়।)
 */

const MESSAGES_PATH = '*/api/v1/chat/rooms/:room_id/messages';
const READ_PATH = '*/api/v1/chat/rooms/:room_id/read';
const RECEIPTS_PATH = '*/api/v1/chat/rooms/:room_id/read-receipts';
const UNREAD_PATH = '*/api/v1/chat/rooms/:room_id/unread-count';
const DIRECT_PATH = '*/api/v1/chat/rooms/direct';
const MESSAGE_PATH = '*/api/v1/chat/messages/:message_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getRooms', () => {
  it('returns the bare array the endpoint sends, not an envelope', async () => {
    const rooms = await getRooms();

    // `Array.isArray` is the assertion, not a detail: `RoomView[]` is the real
    // contract and `{items}` would be a different one.
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.map((room) => room.id)).toEqual(chatRooms.map((room) => room.id));
  });

  it('keeps the two room kinds distinguishable', async () => {
    const rooms = await getRooms();
    const direct = rooms.find((room) => room.id === 601);
    const group = rooms.find((room) => room.id === 602);

    // A direct room has NO title — that is why the UI derives its peer from the
    // member list instead of reading a name off the row.
    expect(direct?.type).toBe('direct');
    expect(direct?.title).toBeNull();
    expect(group?.title).toBe(groupRoom.title);
  });
});

describe('getRoom', () => {
  it('surfaces an unknown room as ROOM_NOT_FOUND', async () => {
    const error = await getRoom(9999).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('ROOM_NOT_FOUND');
    // 4xx: the query provider must not retry it.
    expect(error.isClientError).toBe(true);
  });
});

describe('startDirectRoom', () => {
  it('sends the other user id and returns the existing room', async () => {
    let body: unknown;
    server.use(
      http.post(DIRECT_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(chatRooms[0]);
      }),
    );

    const room = await startDirectRoom(22);

    expect(body).toEqual({ other_user_id: 22 });
    // Find-or-create: an existing pair answers the SAME room, and 200 not 201.
    expect(room.id).toBe(601);
  });

  it('refuses a room with yourself', async () => {
    const error = await startDirectRoom(adminUser.id).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('CANNOT_CHAT_WITH_SELF');
    expect(error.status).toBe(400);
  });
});

describe('getRoomMembers', () => {
  it('is the only place a direct room peer can be found', async () => {
    const { members } = await getRoomMembers(601);

    expect(members.map((member) => member.user_id)).toEqual(
      roomMembers[601]?.members.map((member) => member.user_id),
    );
    // No display names on a member row: the name comes from the profile read.
    expect(members[0]).not.toHaveProperty('display_name');
  });
});

describe('getMessages', () => {
  it('omits the cursor on the first page and sends the limit', async () => {
    let search = '';
    server.use(
      http.get(MESSAGES_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getMessages(601, { limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded as the string "null".
    expect(params.has('cursor')).toBe(false);
  });

  it('passes an opaque cursor back verbatim', async () => {
    let cursor: string | null = null;
    server.use(
      http.get(MESSAGES_PATH, ({ request }) => {
        cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    // The cursor is opaque — this test never parses it, only proves the client
    // does not either.
    await getMessages(601, { cursor: 'eyJvZmZzZXQiOjN9', limit: 3 });

    expect(cursor).toBe('eyJvZmZzZXQiOjN9');
  });
});

describe('sendMessage', () => {
  it('sends a fresh idempotency key so a retried submit cannot double-post', async () => {
    const keys: string[] = [];
    server.use(
      http.post(MESSAGES_PATH, ({ request }) => {
        keys.push(request.headers.get(IDEMPOTENCY_HEADER) ?? '');
        return HttpResponse.json(
          {
            id: 970,
            room_id: 601,
            sender_id: adminUser.id,
            body: 'hello',
            media_id: null,
            created_at: '2026-01-15T10:05:00.000Z',
            is_edited: false,
          },
          { status: 201 },
        );
      }),
    );

    await sendMessage(601, 'hello');
    await sendMessage(601, 'hello');

    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key.length).toBeGreaterThanOrEqual(IDEMPOTENCY_KEY_MIN_LENGTH);
      expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
    }
    // Same text, DIFFERENT keys: the key is per intent, not per body.
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('normalises a rejected send into an AppApiError', async () => {
    server.use(
      http.post(MESSAGES_PATH, () =>
        HttpResponse.json(errorBody('VALIDATION_ERROR', 422, '/api/v1/chat/rooms/601/messages'), {
          status: 422,
        }),
      ),
    );

    const error = await sendMessage(601, '').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

describe('markRead', () => {
  it('sends the explicit message id and echoes the new watermark', async () => {
    let body: unknown;
    server.use(
      http.post(READ_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ user_id: adminUser.id, last_read_message_id: 705 });
      }),
    );

    const state = await markRead(601, 705);

    // Not "mark everything read": the id is required, because the backend
    // rejects one it has not seen (`READ_RECEIPT_INVALID`).
    expect(body).toEqual({ message_id: 705 });
    expect(state.last_read_message_id).toBe(705);
  });
});

describe('getReadReceipts', () => {
  it('reads the peer watermark from the receipts document, not the member list', async () => {
    const { members } = await getReadReceipts(601);

    expect(members).toEqual(roomReadState[601]);
    // The direct-room peer (22) has read up to 704 — the fact the "Seen" badge
    // is built on, and one `RoomMemberView` cannot express.
    expect(members.find((member) => member.user_id === 22)?.last_read_message_id).toBe(704);
  });

  it('accepts a member who has never read anything', async () => {
    server.use(
      http.get(RECEIPTS_PATH, () =>
        HttpResponse.json({
          members: [
            { user_id: adminUser.id, last_read_message_id: 705 },
            { user_id: 22, last_read_message_id: null },
          ],
        }),
      ),
    );

    const { members } = await getReadReceipts(601);

    // `null`, never 0: "has not read" and "read up to message 0" are different
    // claims, and the badge logic distinguishes them.
    expect(members.find((member) => member.user_id === 22)?.last_read_message_id).toBeNull();
  });
});

describe('getRoomUnreadCount', () => {
  it('asks the per-room endpoint and returns { unread }', async () => {
    let path = '';
    server.use(
      http.get(UNREAD_PATH, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ unread: 2 });
      }),
    );

    const count = await getRoomUnreadCount(602);

    expect(path).toBe('/api/v1/chat/rooms/602/unread-count');
    expect(count).toEqual({ unread: 2 });
  });
});

describe('deleteMessage', () => {
  it('resolves on a 204 with no body', async () => {
    server.use(http.delete(MESSAGE_PATH, () => new HttpResponse(null, { status: 204 })));

    await expect(deleteMessage(702)).resolves.toBeUndefined();
  });

  it('does not retry: a second delete is a 404 by design', async () => {
    server.use(
      http.delete(MESSAGE_PATH, () =>
        HttpResponse.json(errorBody('MESSAGE_NOT_FOUND', 404, '/api/v1/chat/messages/702'), {
          status: 404,
        }),
      ),
    );

    const error = await deleteMessage(702).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    // The soft-deleted row is filtered out, so the id is gone — retrying would
    // never succeed, which is why the client never does.
    expect(error.code).toBe('MESSAGE_NOT_FOUND');
    expect(error.isTransient).toBe(false);
  });
});

// Dead-code guard: every path above must be one the shared handlers serve, or
// this suite would be green against a mock nobody uses.
describe('handler wiring', () => {
  it('serves the room list, the members and the messages from the same fixtures', async () => {
    const rooms = await getRooms();
    const { members } = await getRoomMembers(601);

    expect(rooms).toHaveLength(chatRooms.length);
    expect(members).toHaveLength(roomMembers[601]?.members.length ?? 0);
  });

  it('keeps the read-receipts path from being answered by the room handler', async () => {
    // `:room_id` matches one segment, so `/rooms/601/read-receipts` cannot fall
    // through to `GET /rooms/{id}`. The shape assertion is the point: members,
    // never a `RoomView`.
    const receipts = await getReadReceipts(601);

    expect(receipts).toHaveProperty('members');
    expect(receipts).not.toHaveProperty('type');
  });
});
