import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket, fakeSocketFactory } from '@/lib/testing/fake-socket';

import {
  WS_CLOSE_POLICY_VIOLATION,
  WS_CLOSE_RATE_LIMITED,
  WsClient,
  parseWsEvent,
  wsEndpoint,
  type WsClientOptions,
} from './ws';

/**
 * The transport half of F15 — `src/lib/ws.ts`, with no React and no server.
 *
 * Every assertion below pins a promise the backend makes in
 * `src/social_api/api/v1/ws.py` and `src/social_api/realtime/events.py`, because
 * getting any of them wrong is silent: a dropped subscription, a socket that
 * stops reconnecting, or a reconnect storm that spends the 10/min connect budget
 * all look identical from the UI ("notifications just stop").
 *
 * The four behaviours that matter most, and why:
 *  1. A frame the client cannot model is DROPPED, not thrown — one bad frame
 *     must not kill a healthy socket.
 *  2. Room membership dies with the socket, so it is re-sent on every open.
 *  3. 1008 (bad/expired token) buys exactly ONE refresh; a second failure stops
 *     instead of hammering the endpoint with a token that cannot work.
 *  4. 4029 (rate limited) uses the MAX delay, not the base, or the penalty box
 *     never clears.
 *
 * (backend-এর চারটা رفتار এখানে pin করা — ভুল হলে UI-তে শুধু "আর আসে না" দেখায়।)
 */

const TOKEN = 'access-token-1';

/** One well-formed inbox notification, exactly as the server serializes it. */
const INBOX_FRAME = {
  type: 'notification',
  ts: '2026-02-01T10:00:00Z',
  data: {
    id: 11,
    type: 'like_post',
    target_type: 'post',
    target_id: 5,
    actor_id: 22,
    is_read: false,
    read_at: null,
    preview: 'tushar liked your post',
    created_at: '2026-02-01T09:59:58Z',
    unread_delta: 1,
  },
} as const;

/** `noUncheckedIndexedAccess` is on, so index access is narrowed explicitly. */
function socketAt(index = 0): FakeSocket {
  const socket = FakeSocket.instances[index];
  if (!socket) throw new Error(`expected a socket at index ${String(index)}`);
  return socket;
}

function makeClient(
  overrides: Partial<WsClientOptions> & Pick<WsClientOptions, 'getToken'>,
): WsClient {
  return new WsClient({
    url: 'ws://test',
    socketFactory: fakeSocketFactory(),
    // Deterministic backoff: the jitter factor becomes exactly 1.0.
    random: () => 0.5,
    // Keep test output readable; the logger is not part of any assertion.
    logger: () => undefined,
    ...overrides,
  });
}

beforeEach(() => {
  FakeSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseWsEvent', () => {
  it('parses an inbox notification frame', () => {
    const event = parseWsEvent(JSON.stringify(INBOX_FRAME));

    expect(event?.type).toBe('notification');
  });

  it('parses a chat message notification, which shares the notification envelope', () => {
    const event = parseWsEvent(
      JSON.stringify({
        type: 'notification',
        ts: '2026-02-01T10:00:00Z',
        data: {
          kind: 'chat_message',
          room_id: 601,
          sender_id: 22,
          message: {
            id: 9,
            room_id: 601,
            sender_id: 22,
            body: 'hello',
            created_at: '2026-02-01T09:59:58Z',
          },
        },
      }),
    );

    expect(event?.type).toBe('notification');
    if (event?.type !== 'notification') throw new Error('unreachable');
    expect(event.data).toMatchObject({ kind: 'chat_message', room_id: 601 });
  });

  it('keeps `unread` and `unread_delta` distinct', () => {
    const authoritative = parseWsEvent(
      JSON.stringify({ type: 'unread_count', ts: 'now', data: { unread: 4 } }),
    );
    const delta = parseWsEvent(
      JSON.stringify({ type: 'unread_count', ts: 'now', data: { unread_delta: -1 } }),
    );

    expect(authoritative).toMatchObject({ data: { unread: 4 } });
    expect(delta).toMatchObject({ data: { unread_delta: -1 } });
  });

  it('drops malformed JSON instead of throwing', () => {
    expect(parseWsEvent('{not json')).toBeNull();
  });

  it('drops an event type this build does not know', () => {
    expect(
      parseWsEvent(JSON.stringify({ type: 'reaction_added', ts: 'now', data: {} })),
    ).toBeNull();
  });

  it('drops a known type whose payload is the wrong shape', () => {
    expect(parseWsEvent(JSON.stringify({ type: 'notification', ts: 'now', data: {} }))).toBeNull();
  });
});

describe('wsEndpoint', () => {
  it('joins the socket path and encodes the token', () => {
    expect(wsEndpoint('a b/c', 'ws://localhost:8000')).toBe(
      'ws://localhost:8000/api/v1/ws?token=a%20b%2Fc',
    );
  });

  it('strips a trailing slash from the configured origin', () => {
    expect(wsEndpoint(TOKEN, 'ws://localhost:8000/')).toBe(
      `ws://localhost:8000/api/v1/ws?token=${TOKEN}`,
    );
  });
});

describe('WsClient connection lifecycle', () => {
  it('stays idle without a token (anonymous pages open no socket)', () => {
    const client = makeClient({ getToken: () => null });

    client.connect();

    expect(FakeSocket.instances).toHaveLength(0);
    expect(client.status).toBe('closed');
  });

  it('connects with the token in the query string and reports `open`', () => {
    const client = makeClient({ getToken: () => TOKEN });

    client.connect();

    expect(client.status).toBe('connecting');
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socketAt().url).toBe(`ws://test/api/v1/ws?token=${TOKEN}`);

    socketAt().open();

    expect(client.status).toBe('open');
  });

  it('is idempotent — a re-run effect does not open a second socket', () => {
    const client = makeClient({ getToken: () => TOKEN });

    client.connect();
    socketAt().open();
    client.connect();
    client.connect();

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('replays room subscriptions after a reconnect', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });

    // Joined while offline: remembered even though the frame could not be sent.
    client.joinRoom(601);
    expect(FakeSocket.instances).toHaveLength(0);

    client.connect();
    socketAt().open();

    expect(socketAt().sentEvents()).toContainEqual({
      type: 'join_room',
      data: { room_id: 601 },
    });

    socketAt().drop();
    vi.advanceTimersByTime(1_000);

    expect(FakeSocket.instances).toHaveLength(2);
    socketAt(1).open();

    expect(socketAt(1).sentEvents()).toContainEqual({
      type: 'join_room',
      data: { room_id: 601 },
    });
  });

  it('forgets a room after leaveRoom', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });

    client.joinRoom(601);
    client.connect();
    socketAt().open();

    client.leaveRoom(601);
    socketAt().drop();
    vi.advanceTimersByTime(1_000);
    socketAt(1).open();

    expect(socketAt(1).sentEvents()).not.toContainEqual({
      type: 'join_room',
      data: { room_id: 601 },
    });
  });

  it('pings on its own heartbeat so the 60s server read timeout never fires', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN, heartbeatMs: 1_000 });
    client.connect();
    socketAt().open();

    vi.advanceTimersByTime(3_000);

    expect(
      socketAt()
        .sentEvents()
        .filter((event) => event.type === 'ping'),
    ).toHaveLength(3);
  });

  it('answers a server ping even when its own interval was throttled', () => {
    const client = makeClient({ getToken: () => TOKEN, heartbeatMs: 60_000 });
    client.connect();
    const socket = socketAt();
    socket.open();

    socket.receive({ type: 'ping', ts: 'now', data: {} });

    expect(socket.sentEvents()).toEqual([{ type: 'ping' }]);
  });

  it('delivers parsed frames to subscribers and drops unparseable ones', () => {
    const client = makeClient({ getToken: () => TOKEN });
    const seen: string[] = [];
    client.subscribe((event) => seen.push(event.type));

    client.connect();
    const socket = socketAt();
    socket.open();

    socket.receive('{broken');
    socket.receive({ type: 'reaction_added', ts: 'now', data: {} });
    socket.receive(INBOX_FRAME);

    expect(seen).toEqual(['notification']);
  });

  it('keeps delivering when one listener throws', () => {
    const client = makeClient({ getToken: () => TOKEN });
    const seen: string[] = [];
    client.subscribe(() => {
      throw new Error('consumer bug');
    });
    client.subscribe((event) => seen.push(event.type));

    client.connect();
    const socket = socketAt();
    socket.open();
    socket.receive(INBOX_FRAME);

    expect(seen).toEqual(['notification']);
  });

  it('stops delivering after unsubscribe', () => {
    const client = makeClient({ getToken: () => TOKEN });
    const seen: string[] = [];
    const off = client.subscribe((event) => seen.push(event.type));

    client.connect();
    const socket = socketAt();
    socket.open();
    off();
    socket.receive(INBOX_FRAME);

    expect(seen).toEqual([]);
  });
});

describe('WsClient reconnect policy', () => {
  it('retries with exponential backoff after a drop', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });
    client.connect();
    socketAt().open();

    socketAt().drop();

    expect(client.status).toBe('reconnecting');
    // First retry: base (1s) × jitter 1.0.
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // Second consecutive failure: 2s.
    socketAt(1).drop();
    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('resets the backoff after a successful open', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });
    client.connect();
    socketAt().open();
    socketAt().drop();
    vi.advanceTimersByTime(1_000);
    socketAt(1).open();

    socketAt(1).drop();

    // Back to the base delay, not 2s.
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('backs off to the MAX delay when rate limited (4029)', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN, reconnectMaxMs: 30_000 });
    client.connect();
    socketAt().open();

    socketAt().drop(WS_CLOSE_RATE_LIMITED);

    vi.advanceTimersByTime(29_999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('refreshes the token once on 1008 and reopens with the new one', async () => {
    // The refresh writes back to the session store, so `getToken` — which is
    // late-bound on purpose — must return the NEW token for the retry.
    let token = TOKEN;
    const reauthenticate = vi.fn(async () => {
      token = 'access-token-2';
      return token;
    });
    const client = makeClient({ getToken: () => token, reauthenticate });

    client.connect();
    socketAt().open();
    socketAt().drop(WS_CLOSE_POLICY_VIOLATION);

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));

    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(socketAt(1).url).toContain('token=access-token-2');
  });

  it('stops instead of looping when re-authentication fails', async () => {
    const reauthenticate = vi.fn(async () => null);
    const client = makeClient({ getToken: () => TOKEN, reauthenticate });

    client.connect();
    socketAt().open();
    socketAt().drop(WS_CLOSE_POLICY_VIOLATION);

    await vi.waitFor(() => expect(client.status).toBe('closed'));

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('treats a throwing re-authentication as a failed one', async () => {
    const reauthenticate = vi.fn(async () => {
      throw new Error('refresh exploded');
    });
    const client = makeClient({ getToken: () => TOKEN, reauthenticate });

    client.connect();
    socketAt().open();
    socketAt().drop(WS_CLOSE_POLICY_VIOLATION);

    await vi.waitFor(() => expect(client.status).toBe('closed'));

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('still retries a 1008 when no refresh path is configured', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });
    client.connect();
    socketAt().open();

    socketAt().drop(WS_CLOSE_POLICY_VIOLATION);

    expect(client.status).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});

describe('WsClient teardown', () => {
  it('closes the socket on disconnect and never reconnects', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });
    client.connect();
    const socket = socketAt();
    socket.open();

    client.disconnect();

    expect(socket.closedWith).toEqual([{ code: 1000, reason: 'client' }]);
    expect(client.status).toBe('closed');

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after a deliberate close mid-flight', () => {
    vi.useFakeTimers();

    const client = makeClient({ getToken: () => TOKEN });
    client.connect();

    // Closed before the handshake completed — the late `close` must be ignored.
    const socket = socketAt();
    client.disconnect();
    socket.drop();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('refuses to send while not open', () => {
    const client = makeClient({ getToken: () => TOKEN });

    expect(client.send({ type: 'ping' })).toBe(false);

    client.connect();
    expect(client.send({ type: 'ping' })).toBe(false);

    socketAt().open();
    expect(client.send({ type: 'ping' })).toBe(true);
  });
});
