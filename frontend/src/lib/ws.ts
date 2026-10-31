import { z } from 'zod';

import { NOTIFICATION_TYPES } from './api/notifications';
import { wsBaseUrl } from './env';

/**
 * WebSocket foundation (F15).
 *
 * The backend socket lives at `GET /api/v1/ws?token=<accessToken>`
 * (`src/social_api/api/v1/ws.py`), authenticated by the SAME JWT the HTTP client
 * uses — which is why every frame below is modelled on
 * `src/social_api/realtime/events.py` rather than on `contracts/openapi.json`:
 * a WebSocket endpoint produces no OpenAPI operations, so `openapi-typescript`
 * cannot generate these types. This file IS the hand-maintained mirror, and it
 * is written as a Zod schema so a malformed frame is dropped instead of
 * crashing a render tree.
 *
 * Envelope (every frame, both directions):
 *   { "type": <EventType>, "data": {...}, "ts": <iso-8601> }
 *
 * Client → server is a strict subset: `ping`, `join_room`, `leave_room`,
 * `typing`. Server → client is the full set.
 *
 * Three backend behaviours the client MUST respect:
 *
 *  1. `READ_TIMEOUT_SECONDS = 60` — the server closes (1001) if it receives
 *     nothing for a minute, so the client pings every 25s. The server also pings
 *     us every 30s; replying keeps the window open even when our own interval
 *     was throttled in a background tab.
 *  2. Room membership is per-socket (`RoomSubscription` in the endpoint), so a
 *     reconnect loses every subscription and they must be re-sent on open.
 *  3. Connections are rate-limited to 10/min per IP and rejected with 1008
 *     (bad/absent token) or 4029 (rate limited) — both are close frames, NOT
 *     upgrade failures, so the reconnect policy has to distinguish them.
 *
 * No React here on purpose: this is testable without a DOM beyond `WebSocket`,
 * and `use-websocket.ts` is the only consumer that knows about components.
 */

/** Path of the socket, relative to `NEXT_PUBLIC_WS_URL`. */
export const WS_PATH = '/api/v1/ws';

/**
 * 25s, not 30s: comfortably inside the backend's 60s read timeout even with a
 * dropped frame, and cheap enough that presence TTL (60s) never lapses.
 */
export const WS_HEARTBEAT_MS = 25_000;

/**
 * 1s → 2s → 4s → … capped at 30s. Deliberately not faster: the endpoint allows
 * 10 connects/min per IP, and a tight retry loop would exhaust that budget and
 * turn a transient blip into a 4029 storm.
 */
export const WS_RECONNECT_BASE_MS = 1_000;
export const WS_RECONNECT_MAX_MS = 30_000;

/** Backend close codes we branch on (`ws.py`). */
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_RATE_LIMITED = 4029;

/** `WebSocket.OPEN`, spelled out so a fake socket in tests need not expose it. */
const SOCKET_OPEN = 1;

// ---------------------------------------------------------------------------
// Inbound frame schemas — mirrors src/social_api/realtime/events.py
// ---------------------------------------------------------------------------

/**
 * `MessageView` as embedded in a `kind: "chat_message"` push
 * (`src/social_api/modules/chat/schemas.py`). `.passthrough()` because the
 * backend may add fields (e.g. reactions) without that being a breaking change.
 */
const messageViewSchema = z
  .object({
    id: z.number().int(),
    room_id: z.number().int(),
    sender_id: z.number().int(),
    body: z.string(),
    media_id: z.number().int().nullable().optional(),
    created_at: z.string(),
    is_edited: z.boolean().optional(),
  })
  .passthrough();

/**
 * The notification kinds the backend can emit — derived from the API layer's
 * `NOTIFICATION_TYPES` rather than re-listed here, so adding a server-side type
 * updates this schema automatically instead of a silently dropped frame.
 */
const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

/** `NotificationView` + the `unread_delta` hint `push_notification` appends. */
const inboxNotificationSchema = z
  .object({
    id: z.number().int(),
    type: notificationTypeSchema,
    target_type: z.enum(['user', 'post', 'comment']),
    target_id: z.number().int(),
    actor_id: z.number().int(),
    is_read: z.boolean(),
    read_at: z.string().nullable(),
    preview: z.string().nullable(),
    created_at: z.string(),
    unread_delta: z.number().int().optional(),
  })
  .passthrough();

/** `ChatService._publish_message_event` — envelope type `notification`, routed by `kind`. */
const chatMessageNotificationSchema = z.object({
  kind: z.literal('chat_message'),
  room_id: z.number().int(),
  sender_id: z.number().int(),
  message: messageViewSchema,
});

/** `ModerationService` — sent to the reporter when their report reaches a terminal state. */
const reportResolvedNotificationSchema = z.object({
  kind: z.literal('report_resolved'),
  report_id: z.number().int(),
  status: z.string(),
  target_type: z.string(),
  target_id: z.number().int(),
});

/**
 * Three disjoint shapes share the `notification` envelope type, so the union
 * order matters: the two `kind`-tagged forms are checked first, and the inbox
 * row (which has no `kind`) last. A frame matching none of them is dropped —
 * better than handing the UI a half-shaped object.
 */
export const wsNotificationDataSchema = z.union([
  chatMessageNotificationSchema,
  reportResolvedNotificationSchema,
  inboxNotificationSchema,
]);

/**
 * `unread_count` carries EITHER an authoritative `{ unread }` (after mark-all)
 * or a `{ unread_delta }` nudge (after mark-one). Never both.
 */
const unreadCountSchema = z
  .object({
    unread: z.number().int().optional(),
    unread_delta: z.number().int().optional(),
  })
  .passthrough();

/**
 * `ChatService.publish_typing` publishes on the room channel with envelope type
 * `presence` (NOT `typing` — `typing` is only a client → server verb). The
 * sender receives their own event back and is expected to filter on `user_id`.
 */
const presenceSchema = z
  .object({
    kind: z.literal('typing'),
    room_id: z.number().int(),
    user_id: z.number().int(),
  })
  .passthrough();

const roomAckSchema = z.object({ room_id: z.number().int() }).passthrough();

const wsErrorSchema = z
  .object({
    code: z.string(),
    room_id: z.number().int().optional(),
  })
  .passthrough();

export const wsEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), ts: z.string(), data: z.unknown() }),
  z.object({ type: z.literal('pong'), ts: z.string(), data: z.unknown() }),
  z.object({ type: z.literal('notification'), ts: z.string(), data: wsNotificationDataSchema }),
  z.object({ type: z.literal('unread_count'), ts: z.string(), data: unreadCountSchema }),
  z.object({ type: z.literal('presence'), ts: z.string(), data: presenceSchema }),
  z.object({ type: z.literal('joined'), ts: z.string(), data: roomAckSchema }),
  z.object({ type: z.literal('left'), ts: z.string(), data: roomAckSchema }),
  z.object({ type: z.literal('error'), ts: z.string(), data: wsErrorSchema }),
]);

export type WsEvent = z.infer<typeof wsEventSchema>;

export type WsInboundType = WsEvent['type'];

export type WsEventOf<T extends WsInboundType> = Extract<WsEvent, { type: T }>;

export type WsNotificationData = z.infer<typeof wsNotificationDataSchema>;

export type WsChatMessageData = z.infer<typeof chatMessageNotificationSchema>;

export type WsErrorCode = z.infer<typeof wsErrorSchema>['code'];

/** Frames the client is allowed to send (a subset of the server's `EventType`). */
export type WsOutbound =
  | { type: 'ping' }
  | { type: 'join_room'; data: { room_id: number } }
  | { type: 'leave_room'; data: { room_id: number } }
  | { type: 'typing'; data: { room_id: number } };

/**
 * Parse one inbound frame. Returns `null` for anything that is not a frame this
 * client understands — bad JSON, a type the backend added after this build, or
 * a known type with an unexpected payload.
 *
 * Deliberately non-throwing: one malformed frame must not tear down a socket
 * that is otherwise healthy.
 */
export function parseWsEvent(raw: string): WsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = wsEventSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Build the authenticated socket URL. The token rides in the query string. */
export function wsEndpoint(token: string, base: string = wsBaseUrl): string {
  const origin = base.replace(/\/+$/, '');
  return `${origin}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type WsStatus =
  /** Never connected, or deliberately disconnected. */
  | 'idle'
  /** First connection attempt in flight. */
  | 'connecting'
  /** Socket open, heartbeat running. */
  | 'open'
  /** Dropped; a retry is scheduled (or a token refresh is in flight). */
  | 'reconnecting'
  /** Given up: signed out, or re-authentication failed. Needs a new sign-in. */
  | 'closed';

export type WsListener = (event: WsEvent) => void;

export type WsStatusListener = (status: WsStatus) => void;

export type WsClientOptions = {
  /** Socket origin; defaults to `NEXT_PUBLIC_WS_URL`. Tests point this at `ws://test`. */
  url?: string;
  /**
   * Read at connect time, never cached. The access token is replaced in memory
   * on every silent refresh, so a captured value would authenticate with a
   * token that has already been rotated away.
   */
  getToken: () => string | null;
  /**
   * Called once when the server rejects the socket with 1008 (= bad, expired or
   * blacklisted token). Must return a fresh access token, or `null` when the
   * session is genuinely over — in which case the client stops instead of
   * hammering the endpoint.
   */
  reauthenticate?: () => Promise<string | null>;
  /** Injectable for tests; defaults to `new WebSocket(url)`. */
  socketFactory?: (url: string) => WebSocket;
  heartbeatMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Injectable jitter source for deterministic tests. */
  random?: () => number;
  logger?: (message: string, details?: Record<string, unknown>) => void;
};

/**
 * Query-string auth is the backend's contract, but the token then sits in the
 * URL — so it must never be logged. Everything this client logs is scrubbed of
 * the socket URL for that reason.
 */
function defaultLogger(message: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  // `console.warn` rather than `console.info`: the ESLint config allows
  // warn/error only, and a dev-only connection log is exactly a warn.
  console.warn(`[ws] ${message}`, details ?? '');
}

/**
 * One socket, with automatic reconnect.
 *
 * Ownership rule: a caller `connect()`s and `disconnect()`s; the client never
 * gives up on its own except when there is no token to present or
 * re-authentication failed — both mean "the session is gone", which a socket
 * retry loop cannot fix.
 */
export class WsClient {
  private socket: WebSocket | null = null;

  private current: WsStatus = 'idle';

  /** Consecutive failed attempts, reset on a successful open. Drives backoff. */
  private attempt = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Rooms to restore after a reconnect — a dead socket loses them server-side. */
  private readonly rooms = new Set<number>();

  private readonly listeners = new Set<WsListener>();

  private readonly statusListeners = new Set<WsStatusListener>();

  /** The caller's intent, which outlives any individual socket. */
  private wanted = false;

  /** Guards against looping on 1008 when the refresh itself is what fails. */
  private authRetried = false;

  constructor(private readonly options: WsClientOptions) {}

  get status(): WsStatus {
    return this.current;
  }

  /** Subscribe to inbound frames; returns an unsubscriber. */
  subscribe(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to connection-state changes; returns an unsubscriber. */
  onStatus(listener: WsStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Idempotent: safe from an effect that re-runs with a new token identity. */
  connect(): void {
    this.wanted = true;
    if (this.current === 'open' || this.current === 'connecting') return;
    this.clearReconnectTimer();
    this.open();
  }

  /** Deliberate teardown (sign-out or unmount). Never reconnects afterwards. */
  disconnect(): void {
    this.wanted = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      // Detach first: a deliberate close must not be mistaken for a drop and
      // schedule a reconnect.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, 'client');
      } catch {
        // Already closing/closed — nothing to salvage.
      }
    }

    this.attempt = 0;
    this.authRetried = false;
    this.rooms.clear();
    this.setStatus('closed');
  }

  /** Drop references held by React, so a remount starts from a clean slate. */
  destroy(): void {
    this.disconnect();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  /** `false` when the socket is not open yet — callers can then just retry. */
  send(event: WsOutbound): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN || this.current !== 'open') return false;

    try {
      socket.send(JSON.stringify(event));
      return true;
    } catch (error) {
      this.log('send failed', { type: event.type, error: String(error) });
      return false;
    }
  }

  /**
   * Join a room. Remembered even when sent while offline, so the subscription
   * is restored by `handleOpen` after a reconnect.
   */
  joinRoom(roomId: number): void {
    this.rooms.add(roomId);
    this.send({ type: 'join_room', data: { room_id: roomId } });
  }

  leaveRoom(roomId: number): void {
    this.rooms.delete(roomId);
    this.send({ type: 'leave_room', data: { room_id: roomId } });
  }

  // -- internals ------------------------------------------------------------

  private open(): void {
    if (!this.wanted) return;

    const token = this.options.getToken();
    if (!token) {
      // Signed out (or bootstrapping has not minted a token yet). Not an error:
      // the session effect will call connect() again once a token exists.
      this.log('connect skipped: no access token');
      this.setStatus('closed');
      return;
    }

    // "connecting" only for the first attempt; anything after a drop reads as
    // "reconnecting" so the UI can say "Reconnecting…" instead of "Connecting…".
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let socket: WebSocket;
    try {
      socket = this.createSocket(wsEndpoint(token, this.options.url));
    } catch (error) {
      // Malformed `NEXT_PUBLIC_WS_URL`, or a browser that refused the URL.
      this.log('socket construction failed', { error: String(error) });
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen(socket);
    socket.onmessage = (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      if (raw) this.handleMessage(raw);
    };
    // Browsers fire `error` immediately before `close`; the close handler owns
    // the retry decision, so there is nothing useful to do here.
    socket.onerror = () => undefined;
    socket.onclose = (event: CloseEvent) => this.handleClose(socket, event);
  }

  private createSocket(url: string): WebSocket {
    return this.options.socketFactory ? this.options.socketFactory(url) : new WebSocket(url);
  }

  private handleOpen(socket: WebSocket): void {
    // A stale socket from a superseded attempt must not resurrect itself.
    if (this.socket !== socket) return;

    this.attempt = 0;
    this.authRetried = false;
    this.setStatus('open');
    this.startHeartbeat();
    this.log('connected');

    // Re-arm subscriptions: the previous socket's room registrations died with it.
    for (const roomId of this.rooms) {
      this.send({ type: 'join_room', data: { room_id: roomId } });
    }
  }

  private handleMessage(raw: string): void {
    const event = parseWsEvent(raw);
    if (!event) {
      this.log('dropped unparseable frame', { size: raw.length });
      return;
    }

    // Answer the server's 30s ping so a throttled background tab still feeds
    // the 60s read timeout. The reply arrives as `pong`, which is a no-op.
    if (event.type === 'ping') this.send({ type: 'ping' });

    // Copy before iterating: a listener that unsubscribes (or subscribes) must
    // not mutate the set we are walking.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        // A throwing consumer must not kill delivery for the others.
        this.log('listener threw', { type: event.type, error: String(error) });
      }
    }
  }

  private handleClose(socket: WebSocket, event: CloseEvent): void {
    if (this.socket !== socket) return;

    this.socket = null;
    this.stopHeartbeat();

    if (!this.wanted) {
      this.setStatus('closed');
      return;
    }

    this.log('closed', { code: event.code, reason: event.reason });

    if (
      event.code === WS_CLOSE_POLICY_VIOLATION &&
      this.options.reauthenticate &&
      !this.authRetried
    ) {
      this.authRetried = true;
      void this.retryWithFreshToken();
      return;
    }

    // 4029 = the 10/min IP budget is spent; backing off hard is the only way
    // out of the penalty, so the floor is the max delay, not the base.
    this.scheduleReconnect(event.code === WS_CLOSE_RATE_LIMITED ? this.maxDelay() : 0);
  }

  /**
   * Exchange the (probably expired) token via the HTTP session layer and try
   * once more. The refresh is single-flighted inside `refreshAccessToken`, so
   * this cannot race a concurrent 401 from a REST call.
   */
  private async retryWithFreshToken(): Promise<void> {
    this.setStatus('reconnecting');

    let token: string | null = null;
    try {
      token = (await this.options.reauthenticate?.()) ?? null;
    } catch {
      token = null;
    }

    // Signed out / unmounted while the refresh was in flight.
    if (!this.wanted) return;

    if (!token) {
      this.log('re-authentication failed; not retrying');
      this.setStatus('closed');
      return;
    }

    this.open();
  }

  private scheduleReconnect(floorMs = 0): void {
    this.setStatus('reconnecting');
    this.attempt += 1;

    const base = this.options.reconnectBaseMs ?? WS_RECONNECT_BASE_MS;
    const cap = this.maxDelay();
    // `2 ** attempt` overflows to Infinity for large attempts; Math.min caps it
    // before it can reach setTimeout.
    const exponential = Math.min(cap, base * 2 ** (this.attempt - 1));
    // ±25% jitter: many tabs reconnecting after a deploy must not sync up.
    const jitter = 0.75 + this.random() * 0.5;
    const delay = Math.max(floorMs, Math.round(exponential * jitter));

    this.log('reconnect scheduled', { attempt: this.attempt, delayMs: delay });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private maxDelay(): number {
    return this.options.reconnectMaxMs ?? WS_RECONNECT_MAX_MS;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatMs ?? WS_HEARTBEAT_MS;
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private random(): number {
    return this.options.random ? this.options.random() : Math.random();
  }

  private setStatus(next: WsStatus): void {
    if (this.current === next) return;
    this.current = next;
    for (const listener of [...this.statusListeners]) {
      try {
        listener(next);
      } catch {
        // Status listeners are observability only; never let one break the socket.
      }
    }
  }

  private log(message: string, details?: Record<string, unknown>): void {
    (this.options.logger ?? defaultLogger)(message, details);
  }
}
