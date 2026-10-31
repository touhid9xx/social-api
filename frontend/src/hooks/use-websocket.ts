'use client';

import { useContext, useEffect, useRef } from 'react';

import {
  WebSocketContext,
  type WebSocketContextValue,
} from '@/components/shared/websocket-provider';
import type { WsEvent, WsEventOf, WsInboundType, WsStatus } from '@/lib/ws';

/**
 * Consumer side of the app-wide socket (`components/shared/websocket-provider`).
 *
 * Three hooks, one per question a component actually asks:
 *  - `useWebSocket()`  — the whole handle, for chat (needs `joinRoom`);
 *  - `useWsStatus()`   — "are we live?", for a connection banner;
 *  - `useWsEvent()`    — "tell me when X arrives", for cache invalidation (F16).
 */

export function useWebSocket(): WebSocketContextValue {
  const context = useContext(WebSocketContext);

  if (!context) {
    // Fail loudly at the first render instead of silently never receiving
    // events — a muted socket is almost impossible to debug from the UI.
    throw new Error(
      'useWebSocket must be used inside <WebSocketProvider> (mounted in the root layout).',
    );
  }

  return context;
}

export function useWsStatus(): WsStatus {
  return useWebSocket().status;
}

/**
 * Subscribe to one inbound event type for the lifetime of the component.
 *
 * `handler` is held in a ref so an inline arrow function does not tear down and
 * re-add the subscription on every render — which matters because the
 * subscription lives in a `Set` on a long-lived client, not in React state.
 */
export function useWsEvent<T extends WsInboundType>(
  type: T,
  handler: (event: WsEventOf<T>) => void,
): void {
  const { subscribe } = useWebSocket();

  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () =>
      subscribe((event: WsEvent) => {
        if (event.type !== type) return;
        // The `event.type === type` guard above is what makes this cast sound:
        // the discriminated union's members are unique by `type`.
        handlerRef.current(event as WsEventOf<T>);
      }),
    [subscribe, type],
  );
}
