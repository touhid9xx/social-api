'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { prependMessage } from '@/hooks/use-chat-actions';
import { useMe } from '@/hooks/use-me';
import { useWebSocket, useWsEvent } from '@/hooks/use-websocket';
import { sendTyping, type MessageView } from '@/lib/api/chat';
import { queryKeys } from '@/lib/api/query-keys';

/**
 * How long a "typing" claim stays on screen.
 *
 * The typing frame is fire-and-forget: the backend publishes exactly one event
 * per HTTP call and never sends a "stopped typing" counterpart. Without a local
 * expiry the line would stay up forever after a single keystroke, so it is
 * dropped on a timer — deliberately longer than the outbound throttle below, so
 * a person who keeps typing keeps the line up on one refresh per interval.
 */
export const TYPING_HOLD_MS = 5_000;

/**
 * Minimum gap between two outbound typing calls.
 *
 * `POST /chat/rooms/{id}/typing` is rate limited to 60/minute, and a keystroke
 * is not a user intent — it is noise. Three seconds keeps a fast typist at ~20
 * calls/minute, well inside the budget, while the 5 s hold above keeps the
 * indicator continuous.
 */
export const TYPING_THROTTLE_MS = 3_000;

/**
 * Pull the pushed {@link MessageView} out of a `chat_message` frame.
 *
 * The frame arriving here has already been through `wsNotificationDataSchema`,
 * so the body is known good — but TypeScript cannot see that: the inbox variant
 * of the `notification` union is `.passthrough()`, and its index signature keeps
 * `kind` typed as `unknown`, so the union never collapses to the chat variant
 * and `data.message` stays `unknown`. Narrowing the one field this hook consumes
 * is cheaper than casting the frame, and it keeps the rule that a shape we do not
 * recognise never reaches the cache (`prependMessage` inserts this object
 * verbatim, so a stub would render as a blank row).
 */
function pushedMessage(frame: unknown): MessageView | null {
  if (typeof frame !== 'object' || frame === null) return null;
  const message = (frame as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) return null;
  return typeof (message as { id?: unknown }).id === 'number' ? (message as MessageView) : null;
}

/**
 * Live behaviour for one open room.
 *
 * Three things happen here, and each exists because of a specific backend fact:
 *
 *  1. **Join on mount.** `ws.py` merges `ws:user:{self}` with `ws:room:{id}`,
 *     but a room channel carries nothing until the socket subscribes to it. No
 *     join means no `chat_message` frame for the room the reader is looking at.
 *     The client remembers the room and re-sends `join_room` after a reconnect,
 *     so the effect only has to express "we are here" — it does not babysit the
 *     connection state.
 *
 *  2. **Patch the pushed message in.** Refetching on every frame would throw away
 *     every older page the reader scrolled back through and jump them to the top
 *     of the thread. `prependMessage` is the same insert the send mutation uses.
 *     `RealtimeBridge` still invalidates the key (with `refetchType: 'none'`) so
 *     rooms that are *not* open revalidate on their next mount.
 *
 *  3. **Typing over HTTP, not the socket.** The `typing` verb is modelled in
 *     `lib/ws.ts` because the server accepts the frame — `_reader_loop` ignores
 *     it. The only publisher is `POST /rooms/{id}/typing`, so that is what this
 *     hook calls. Failures are swallowed: a dropped typing indicator is not an
 *     error worth a toast, and the rate limiter must never surface as one.
 */
export function useRoomLive(roomId: number): {
  /** Users currently typing in this room, excluding me. */
  typingIds: number[];
  /** Call on every non-empty draft change; throttled internally. */
  notifyTyping: () => void;
} {
  const queryClient = useQueryClient();
  const { joinRoom, leaveRoom } = useWebSocket();
  const { data: me } = useMe();
  const myId = me?.user_id;

  const [typingIds, setTypingIds] = useState<number[]>([]);
  const expiry = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearTypist = useCallback((userId: number) => {
    const timer = expiry.current.get(userId);
    if (timer !== undefined) clearTimeout(timer);
    expiry.current.delete(userId);
    setTypingIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : current,
    );
  }, []);

  // One cleanup for every pending timer: an unmount that left a timeout running
  // would set state on a gone component.
  useEffect(() => {
    const timers = expiry.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    joinRoom(roomId);
    return () => leaveRoom(roomId);
  }, [joinRoom, leaveRoom, roomId]);

  useWsEvent('notification', (event) => {
    const data = event.data;
    // Two positive steps, like `RealtimeBridge`: the inbox variant is a
    // `passthrough()` object, so its index signature would otherwise swallow the
    // `kind` discriminant and leave `data.message` as `unknown`.
    if (!('kind' in data)) return;
    if (data.kind !== 'chat_message') return;
    if (data.room_id !== roomId) return;
    // My own message is not skipped: this tab already patched it from the send
    // response, but another tab of mine did not — and `prependMessage` drops the
    // duplicate by id, so handling it again costs nothing.
    const message = pushedMessage(data);
    if (message === null) return;

    queryClient.setQueryData<unknown>(queryKeys.chat.messages(roomId), (cached: unknown) =>
      prependMessage(cached, message),
    );
  });

  useWsEvent('presence', (event) => {
    const { room_id: frameRoomId, user_id: userId } = event.data;
    if (frameRoomId !== roomId) return;
    // The publisher gets its own frame back; the composer already knows.
    if (userId === myId) return;

    setTypingIds((current) => (current.includes(userId) ? current : [...current, userId]));

    const pending = expiry.current.get(userId);
    if (pending !== undefined) clearTimeout(pending);
    expiry.current.set(
      userId,
      setTimeout(() => clearTypist(userId), TYPING_HOLD_MS),
    );
  });

  const lastSentAt = useRef(0);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentAt.current < TYPING_THROTTLE_MS) return;
    lastSentAt.current = now;
    void sendTyping(roomId).catch(() => {
      // Ignored on purpose — see (3) above.
    });
  }, [roomId]);

  return { typingIds, notifyTyping };
}
