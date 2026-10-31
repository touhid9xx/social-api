import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketProvider } from '@/components/shared/websocket-provider';
import { queryKeys } from '@/lib/api/query-keys';
import { clearTokens, setAccessToken } from '@/lib/api/tokens';
import { FakeSocket } from '@/lib/testing/fake-socket';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';

import { useMe } from './use-me';
import { TYPING_HOLD_MS, TYPING_THROTTLE_MS, useRoomLive } from './use-room-live';

/**
 * Live behaviour for one open room — the F13 half that the REST caches cannot
 * express.
 *
 * Four backend facts are pinned here, because each is a place this hook could
 * silently do nothing at all:
 *
 *  1. **A room channel is silent until joined.** `_pubsub_loop` merges
 *     `ws:user:{self}` with `ws:room:{id}`, so without `join_room` the thread
 *     never sees a single `chat_message`. The REST cache would look correct and
 *     simply never update.
 *  2. **A pushed message is PATCHED IN, not refetched.** Invalidating the
 *     infinite query would discard every older page the reader scrolled back
 *     through and jump them to the top.
 *  3. **Typing is not a socket verb.** `_reader_loop` handles only
 *     ping/join_room/leave_room, so the indicator is sent over
 *     `POST /rooms/{id}/typing`, and the server publishes one `presence` frame
 *     with no "stopped typing" counterpart — hence the local hold.
 *  4. **The sender receives their own frame back** (`ws.py:122`), so the hook
 *     must ignore it or every typist would see their own ghost.
 */

const ROOM_ID = 601;
const OTHER_ROOM_ID = 602;
const TS = '2026-02-01T10:00:00Z';

/** The fixture user — "me" in every chat suite. */
const MY_ID = 21;
/** The direct peer of room 601. */
const PEER_ID = 22;

let captured: QueryClient | null = null;

function CaptureClient() {
  captured = useQueryClient();
  return null;
}

function client(): QueryClient {
  if (!captured) throw new Error('the query client was not captured');
  return captured;
}

function socket(): FakeSocket {
  const first = FakeSocket.instances[0];
  if (!first) throw new Error('expected the provider to open a socket');
  return first;
}

/**
 * Renders both halves of the hook's output plus the shared `/users/me` query, so
 * a test can wait for "my id is known" instead of assuming it. Without that gate
 * the "ignore my own frame" case would pass while `myId` was still `undefined`.
 */
function Probe({ roomId = ROOM_ID }: { roomId?: number }) {
  const { typingIds, notifyTyping } = useRoomLive(roomId);
  const { data: me } = useMe();

  return (
    <>
      <span data-testid="me">{me ? String(me.user_id) : 'pending'}</span>
      <span data-testid="typing">{typingIds.join(',')}</span>
      <button type="button" onClick={notifyTyping}>
        type
      </button>
    </>
  );
}

/** Mount the hook signed in, and complete the handshake. */
function mount(): FakeSocket {
  setAccessToken('token-1');
  renderWithProviders(
    <WebSocketProvider>
      <CaptureClient />
      <Probe />
    </WebSocketProvider>,
  );

  const open = socket();
  act(() => open.open());
  return open;
}

function deliver(target: FakeSocket, frame: unknown): void {
  act(() => target.receive(frame));
}

function typingFrame(roomId: number, userId: number) {
  return { type: 'presence', ts: TS, data: { kind: 'typing', room_id: roomId, user_id: userId } };
}

function chatFrame(roomId: number, messageId: number) {
  return {
    type: 'notification',
    ts: TS,
    data: {
      kind: 'chat_message',
      room_id: roomId,
      sender_id: PEER_ID,
      message: {
        id: messageId,
        room_id: roomId,
        sender_id: PEER_ID,
        body: 'ping',
        created_at: TS,
      },
    },
  };
}

/** Seed one message page in the cache the thread would have produced. */
function seedMessages(roomId: number, ids: number[]): { pages: unknown[]; pageParams: unknown[] } {
  const seed = {
    pages: [{ items: ids.map((id) => ({ id })), next_cursor: null }],
    pageParams: [null],
  };
  client().setQueryData(queryKeys.chat.messages(roomId), seed);
  return seed;
}

function cachedIds(roomId: number): number[] {
  const data = client().getQueryData<{ pages: Array<{ items: Array<{ id: number }> }> }>(
    queryKeys.chat.messages(roomId),
  );
  return data?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? [];
}

beforeEach(() => {
  FakeSocket.reset();
  // jsdom's WebSocket would attempt a real connection; the fake records instead.
  vi.stubGlobal('WebSocket', FakeSocket);
  clearTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // The throttle case pins `Date.now`; left in place it would freeze the clock for
  // every later test in this file.
  vi.restoreAllMocks();
});

describe('useRoomLive — room subscription', () => {
  it('joins the room on mount and leaves it on unmount', () => {
    setAccessToken('token-1');
    const { unmount } = renderWithProviders(
      <WebSocketProvider>
        <Probe />
      </WebSocketProvider>,
    );
    const open = socket();
    act(() => open.open());

    // A room channel carries nothing until the socket subscribes to it.
    expect(open.sentEvents()).toContainEqual({ type: 'join_room', data: { room_id: ROOM_ID } });

    act(() => unmount());

    // Leaving is not housekeeping: a stale subscription keeps pushing another
    // room's messages into a cache nobody is looking at.
    expect(open.sentEvents()).toContainEqual({ type: 'leave_room', data: { room_id: ROOM_ID } });
  });
});

describe('useRoomLive — pushed messages', () => {
  it('prepends a pushed message into this room instead of refetching', () => {
    const open = mount();
    seedMessages(ROOM_ID, [9000]);
    const before = client().getQueryData(queryKeys.chat.messages(ROOM_ID));
    const invalidations = vi.spyOn(client(), 'invalidateQueries');

    deliver(open, chatFrame(ROOM_ID, 9001));

    // Newest-first pages: the new row belongs at the head of the first page.
    expect(cachedIds(ROOM_ID)).toEqual([9001, 9000]);
    // A refetch would throw away every older page the reader scrolled back to.
    expect(invalidations).not.toHaveBeenCalled();
    expect(client().getQueryData(queryKeys.chat.messages(ROOM_ID))).not.toBe(before);
  });

  it('drops a message pushed for a room that is not open', () => {
    const open = mount();
    const seed = seedMessages(ROOM_ID, [9000]);

    deliver(open, chatFrame(OTHER_ROOM_ID, 9001));

    expect(client().getQueryData(queryKeys.chat.messages(ROOM_ID))).toBe(seed);
    expect(cachedIds(ROOM_ID)).toEqual([9000]);
  });

  it('ignores a frame that is not a chat message', () => {
    const open = mount();
    const seed = seedMessages(ROOM_ID, [9000]);

    // The `notification` envelope carries three unrelated payloads; an inbox row
    // must not be mistaken for a chat push.
    deliver(open, {
      type: 'notification',
      ts: TS,
      data: { id: 12, type: 'follow', target_type: 'user', target_id: PEER_ID, is_read: false },
    });

    expect(client().getQueryData(queryKeys.chat.messages(ROOM_ID))).toBe(seed);
  });
});

describe('useRoomLive — typing', () => {
  it('shows the peer typing and drops the line once the hold expires', async () => {
    const open = mount();
    await waitFor(() => {
      expect(screen.getByTestId('me')).toHaveTextContent(String(MY_ID));
    });

    // Fake timers only from here: the frame's expiry is the timer under test, and
    // every query this hook needs has already settled above.
    vi.useFakeTimers();
    deliver(open, typingFrame(ROOM_ID, PEER_ID));

    expect(screen.getByTestId('typing')).toHaveTextContent(String(PEER_ID));

    // The server never sends "stopped typing", so the line must expire on its own
    // — otherwise one keystroke leaves it up forever.
    act(() => {
      vi.advanceTimersByTime(TYPING_HOLD_MS);
    });

    expect(screen.getByTestId('typing')).toHaveTextContent('');
  });

  it('ignores my own typing frame', async () => {
    const open = mount();
    await waitFor(() => {
      expect(screen.getByTestId('me')).toHaveTextContent(String(MY_ID));
    });

    // The publisher gets its own event back on the room channel (`ws.py:122`).
    deliver(open, typingFrame(ROOM_ID, MY_ID));

    expect(screen.getByTestId('typing')).toHaveTextContent('');
  });

  it('ignores typing in another room', async () => {
    const open = mount();
    await waitFor(() => {
      expect(screen.getByTestId('me')).toHaveTextContent(String(MY_ID));
    });

    deliver(open, typingFrame(OTHER_ROOM_ID, PEER_ID));

    expect(screen.getByTestId('typing')).toHaveTextContent('');
  });

  it('sends at most one typing call per throttle window', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/v1/chat/rooms/:room_id/typing', () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    // Freeze the wall clock: the throttle compares `Date.now()` deltas, so with a
    // real clock this assertion would be decided by how long two userEvent clicks
    // happen to take on the machine, not by the hook. Pinning it makes "inside the
    // window" and "past the window" both exact.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const user = userEvent.setup();
    mount();

    const type = screen.getByRole('button', { name: 'type' });

    await user.click(type);
    await waitFor(() => {
      expect(calls).toBe(1);
    });

    // The endpoint is rate limited to 60/min and a keystroke is noise: a second
    // click at the same instant must never reach the network. Sleeping a beat is
    // what makes this a real negative — if the call had been dispatched it would
    // already have been counted.
    await user.click(type);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);

    // The window must reopen, or one keystroke would disable typing for the rest
    // of the session.
    now.mockReturnValue(1_000_000 + TYPING_THROTTLE_MS);
    await user.click(type);
    await waitFor(() => {
      expect(calls).toBe(2);
    });
  });
});
