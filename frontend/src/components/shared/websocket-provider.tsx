'use client';

import { createContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { refreshAccessToken } from '@/lib/api/client';
import { useSessionStore } from '@/lib/api/tokens';
import { WsClient, type WsEvent, type WsOutbound, type WsStatus } from '@/lib/ws';

/**
 * One WebSocket for the whole tab.
 *
 * The backend allows a single socket per connection and counts each one into the
 * presence TTL, so a per-component socket would inflate the presence counter and
 * multiply reconnect storms. Mounted once in the root layout, next to
 * `SessionBootstrap` — which is what makes the token appear in the first place.
 *
 * The socket authenticates with the in-memory access token, so:
 *  - no token  -> stay disconnected (anonymous pages never open a socket);
 *  - token     -> connect, and reconnect on drop;
 *  - sign-out  -> disconnect and stay down.
 *
 * What it does NOT do is consume events. Wiring events into the query cache is
 * F16's job; this provider only guarantees a live, correctly-authenticated
 * connection and hands frames to whoever subscribes.
 *
 * (একটাই socket পুরো ট্যাবের জন্য — presence কাউন্টার আর reconnect storm এড়াতে;
 *  F16-এ এই provider থেকেই ইভেন্ট ধরে cache invalidate করা হবে।)
 */
export type WebSocketContextValue = {
  status: WsStatus;
  /** `false` while the socket is not open — callers can simply retry later. */
  send: (event: WsOutbound) => boolean;
  joinRoom: (roomId: number) => void;
  leaveRoom: (roomId: number) => void;
  subscribe: (listener: (event: WsEvent) => void) => () => void;
};

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  // Booleans, not the token value: a silently-refreshed token must NOT tear the
  // socket down and build a new one. `getToken` below is late-bound, so the
  // client always presents whatever is current at connect time.
  const signedIn = useSessionStore((state) => Boolean(state.accessToken));
  const accessToken = useSessionStore((state) => state.accessToken);

  const [status, setStatus] = useState<WsStatus>('idle');

  // Declared before the effects that read it, so React's declaration-order
  // effect flush updates the ref before the connect effect runs.
  const tokenRef = useRef<string | null>(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const client = useMemo(
    () =>
      new WsClient({
        getToken: () => tokenRef.current,
        // 1008 means the JWT was rejected — expired, revoked, or the user was
        // deleted. One refresh, then stop: a socket that keeps retrying with a
        // dead token burns the 10/min connect budget for nothing.
        reauthenticate: async () => {
          try {
            return await refreshAccessToken();
          } catch {
            return null;
          }
        },
      }),
    [],
  );

  useEffect(() => client.onStatus(setStatus), [client]);

  useEffect(() => {
    if (!signedIn) {
      client.disconnect();
      return;
    }
    client.connect();
    // Unmount or sign-out: close without scheduling a retry.
    return () => client.disconnect();
  }, [client, signedIn]);

  /**
   * Sleep/wake hygiene. A laptop resume can leave a socket that the browser
   * never reported as closed — `readyState` stays OPEN and no frames arrive —
   * so nudge the client whenever the tab is looked at again or the network
   * comes back. `connect()` is idempotent, so this is free when healthy.
   */
  useEffect(() => {
    if (!signedIn) return;

    const resume = () => {
      if (client.status !== 'open') client.connect();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };

    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [client, signedIn]);

  const value = useMemo<WebSocketContextValue>(
    () => ({
      status,
      send: (event) => client.send(event),
      joinRoom: (roomId) => client.joinRoom(roomId),
      leaveRoom: (roomId) => client.leaveRoom(roomId),
      subscribe: (listener) => client.subscribe(listener),
    }),
    [client, status],
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}
