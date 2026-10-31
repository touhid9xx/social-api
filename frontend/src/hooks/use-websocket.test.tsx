import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketProvider } from '@/components/shared/websocket-provider';
import { useSessionStore, clearTokens, setAccessToken } from '@/lib/api/tokens';
import { FakeSocket } from '@/lib/testing/fake-socket';

import { useWebSocket, useWsEvent, useWsStatus } from './use-websocket';

// The provider's 1008 path calls the HTTP refresh; here it must never be reached,
// and if it is, the test should fail loudly rather than try to hit the network.
vi.mock('@/lib/api/client', () => ({
  refreshAccessToken: vi.fn(async () => null),
}));

/**
 * The React half of F15.
 *
 * `WsClient` is covered directly in `src/lib/ws.test.ts`; this suite pins the
 * three things only the React layer can get wrong:
 *
 *  1. **When** a socket exists — signed in ⇒ one socket, signed out ⇒ none. A
 *     socket opened on an anonymous page would inflate presence counts and 1008
 *     immediately, so this boundary is the provider's whole job.
 *  2. **That a rotating token does not rebuild it** — the provider keys its
 *     effect on a `signedIn` boolean and reads the token late-bound, so a silent
 *     refresh (which replaces `accessToken`) must NOT tear down a working socket.
 *  3. **That `useWsEvent` filters by type**, because every event shares one
 *     fan-out: a chat frame must not reach a notification handler (F16).
 *
 * (signed-in হলেই একটাই socket; token বদলালে socket ভাঙা যাবে না।)
 */

function StatusProbe() {
  return <span data-testid="status">{useWsStatus()}</span>;
}

function EventProbe({ onEvent }: { onEvent: (event: { type: string }) => void }) {
  useWsEvent('notification', (event) => onEvent(event));
  return null;
}

function status(): string {
  return screen.getByTestId('status').textContent ?? '';
}

function socketAt(index = 0): FakeSocket {
  const socket = FakeSocket.instances[index];
  if (!socket) throw new Error(`expected a socket at index ${String(index)}`);
  return socket;
}

beforeEach(() => {
  FakeSocket.reset();
  // jsdom's WebSocket would attempt a real connection; the fake records instead.
  vi.stubGlobal('WebSocket', FakeSocket);
  clearTokens();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<WebSocketProvider>', () => {
  it('renders children and opens no socket while signed out', () => {
    render(
      <WebSocketProvider>
        <StatusProbe />
      </WebSocketProvider>,
    );

    expect(status()).toBe('closed');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('connects when an access token appears', () => {
    setAccessToken('token-1');

    render(
      <WebSocketProvider>
        <StatusProbe />
      </WebSocketProvider>,
    );

    expect(status()).toBe('connecting');
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socketAt().url).toContain('token=token-1');

    act(() => socketAt().open());

    expect(status()).toBe('open');
  });

  it('does not rebuild the socket when the token silently rotates', () => {
    setAccessToken('token-1');

    render(
      <WebSocketProvider>
        <StatusProbe />
      </WebSocketProvider>,
    );
    act(() => socketAt().open());

    act(() => setAccessToken('token-2'));

    expect(useSessionStore.getState().accessToken).toBe('token-2');
    expect(FakeSocket.instances).toHaveLength(1);
    expect(status()).toBe('open');
  });

  it('closes the socket on sign-out and stays closed', () => {
    setAccessToken('token-1');

    render(
      <WebSocketProvider>
        <StatusProbe />
      </WebSocketProvider>,
    );
    const socket = socketAt();
    act(() => socket.open());

    act(() => clearTokens());

    expect(socket.closedWith).toEqual([{ code: 1000, reason: 'client' }]);
    expect(status()).toBe('closed');
  });

  it('reconnects when the tab comes back online', () => {
    setAccessToken('token-1');

    render(
      <WebSocketProvider>
        <StatusProbe />
      </WebSocketProvider>,
    );
    socketAt().open();

    // A drop the browser reports, then the network returning before the backoff
    // timer elapses: `online` must not wait out the scheduled retry.
    act(() => socketAt().drop());
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('exposes join/leave through the context', () => {
    setAccessToken('token-1');

    let handle: ReturnType<typeof useWebSocket> | null = null;
    function Capture() {
      handle = useWebSocket();
      return null;
    }

    render(
      <WebSocketProvider>
        <Capture />
      </WebSocketProvider>,
    );
    act(() => socketAt().open());

    act(() => handle?.joinRoom(601));
    expect(socketAt().sentEvents()).toContainEqual({ type: 'join_room', data: { room_id: 601 } });

    act(() => handle?.leaveRoom(601));
    expect(socketAt().sentEvents()).toContainEqual({ type: 'leave_room', data: { room_id: 601 } });
  });
});

describe('useWsEvent', () => {
  it('delivers only events of the requested type', () => {
    setAccessToken('token-1');
    const onEvent = vi.fn();

    render(
      <WebSocketProvider>
        <EventProbe onEvent={onEvent} />
      </WebSocketProvider>,
    );
    const socket = socketAt();
    act(() => socket.open());

    act(() => {
      socket.receive({ type: 'pong', ts: 'now', data: {} });
      socket.receive({ type: 'unread_count', ts: 'now', data: { unread: 3 } });
    });
    expect(onEvent).not.toHaveBeenCalled();

    act(() =>
      socket.receive({
        type: 'notification',
        ts: 'now',
        data: {
          id: 11,
          type: 'follow',
          target_type: 'user',
          target_id: 22,
          actor_id: 23,
          is_read: false,
          read_at: null,
          preview: null,
          created_at: '2026-02-01T09:59:58Z',
          unread_delta: 1,
        },
      }),
    );

    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    setAccessToken('token-1');
    const onEvent = vi.fn();

    const view = render(
      <WebSocketProvider>
        <EventProbe onEvent={onEvent} />
      </WebSocketProvider>,
    );
    const socket = socketAt();
    act(() => socket.open());
    view.unmount();

    act(() =>
      socket.receive({
        type: 'notification',
        ts: 'now',
        data: {
          id: 12,
          type: 'follow',
          target_type: 'user',
          target_id: 22,
          actor_id: 23,
          is_read: false,
          read_at: null,
          preview: null,
          created_at: '2026-02-01T09:59:58Z',
        },
      }),
    );

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('throws a pointed error when used outside the provider', () => {
    // React logs the caught error; keep the suite output readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<StatusProbe />)).toThrow(/WebSocketProvider/);

    consoleError.mockRestore();
  });
});
