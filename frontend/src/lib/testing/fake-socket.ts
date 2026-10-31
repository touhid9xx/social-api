/**
 * A hand-rolled `WebSocket` stand-in for the F15 transport tests.
 *
 * `WsClient` (`src/lib/ws.ts`) only ever touches five things on a socket —
 * `readyState`, `send`, and the four `on*` handler slots — so a real server is
 * unnecessary (and undesirable: the endpoint is rate-limited to 10 connects/min
 * per IP). This fake drives the client deterministically: `open()` completes the
 * handshake, `receive()` delivers a frame, `drop()` closes server-side.
 *
 * Not named `*.test.ts` on purpose — it is a helper, not a suite.
 *
 * (socket-টা fake — real `ws` endpoint 10/min rate-limited, তাই টেস্টে দরকার নেই।)
 */

/** `WebSocket.readyState` values, spelled out so the fake needs no globals. */
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export class FakeSocket {
  /**
   * Every socket constructed through the stubbed global, in creation order.
   * Lets a test assert "no socket was opened" and "the reconnect built a second
   * one" without plumbing a factory through React.
   */
  static readonly instances: FakeSocket[] = [];

  static reset(): void {
    FakeSocket.instances.length = 0;
  }

  readyState: number = CONNECTING;

  /** Raw frames the client sent, in order. */
  readonly sent: string[] = [];

  /** Close calls the client made (i.e. deliberate teardown, not a server drop). */
  readonly closedWith: Array<{ code: number; reason: string }> = [];

  onopen: ((event: Event) => void) | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;

  onerror: ((event: Event) => void) | null = null;

  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.closedWith.push({ code, reason });
    this.readyState = CLOSED;
  }

  // -- server-side simulation ------------------------------------------------

  /** Complete the handshake (the server accepted the token). */
  open(): void {
    this.readyState = OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Deliver one frame; objects are serialized the way the server does. */
  receive(frame: unknown): void {
    const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.onmessage?.({ data } as MessageEvent);
  }

  /** The server closed the connection (1006 network drop by default). */
  drop(code = 1006, reason = ''): void {
    this.readyState = CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  /** Decoded frames the client sent — far easier to assert on than raw strings. */
  sentEvents(): Array<{ type: string; data?: unknown }> {
    return this.sent.map((raw) => JSON.parse(raw) as { type: string; data?: unknown });
  }
}

/** `socketFactory` for `WsClient`, so a test never needs to touch globals. */
export function fakeSocketFactory(): (url: string) => WebSocket {
  return (url) => new FakeSocket(url) as unknown as WebSocket;
}
