import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketProvider } from '@/components/shared/websocket-provider';
import type { Locale } from '@/i18n/config';
import { queryKeys } from '@/lib/api/query-keys';
import { clearTokens, setAccessToken } from '@/lib/api/tokens';
import { FakeSocket } from '@/lib/testing/fake-socket';
import { renderWithProviders } from '@/lib/testing/render';

import { RealtimeBridge } from './realtime-bridge';

/**
 * The F16 bridge: socket frame → React Query cache.
 *
 * `WsClient` and `useWsEvent` are covered by their own suites; what only this
 * component can get wrong is WHERE a frame lands. Three rules the backend forces
 * (`src/social_api/realtime/events.py`):
 *
 *  1. The `notification` envelope carries three unrelated payloads, split by
 *     `kind`. A `chat_message` must invalidate chat and touch nothing else; a
 *     `report_resolved` must only toast.
 *  2. A pushed inbox row is PREPENDED, never an invalidation — invalidating an
 *     infinite query refetches every page already scrolled.
 *  3. `unread_delta` is never arithmetic: `unread` counts rows past the loaded
 *     pages, so the client cannot derive it, and the mark-read mutation already
 *     invalidates the same key. Only an absolute `unread` is written straight in.
 *
 * (frame কোথায় বসবে সেটাই এখানে pin করা — cache-এ যোগ-বিয়োগ নয়, invalidate বা বসানো।)
 */

const { toastMessage, toastSuccess, toastError } = vi.hoisted(() => ({
  toastMessage: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { message: toastMessage, success: toastSuccess, error: toastError },
}));

const TS = '2026-02-01T10:00:00Z';

type CachedPage = { items: Array<{ id: number }>; next_cursor: string | null };
type CachedInbox = { pages: CachedPage[]; pageParams: unknown[] };

/** The client `QueryProvider` created, captured from inside the tree. */
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

/** Mount the bridge with the providers it needs, and complete the handshake. */
function mount(locale: Locale = 'en'): FakeSocket {
  setAccessToken('token-1');
  renderWithProviders(
    <WebSocketProvider>
      <CaptureClient />
      <RealtimeBridge />
    </WebSocketProvider>,
    { locale },
  );

  const open = socket();
  act(() => open.open());
  return open;
}

function deliver(target: FakeSocket, frame: unknown): void {
  act(() => target.receive(frame));
}

/** A real `NotificationView` row, the shape the inbox cache holds. */
function inboxRow(id: number) {
  return {
    id,
    type: 'follow',
    target_type: 'user',
    target_id: 22,
    actor_id: 23,
    is_read: false,
    read_at: null,
    preview: null,
    created_at: TS,
    unread_delta: 1,
  };
}

/** The staff variant: `admin_new_user`, the one `SYSTEM_NOTIFICATION_TYPES` member. */
function systemRow(id: number) {
  return { ...inboxRow(id), type: 'admin_new_user' };
}

/**
 * Seed one scope's inbox. The key is built through `list({ scope })`, i.e. the
 * exact key `useNotifications` uses, so a prefix write that misses it fails here
 * rather than in production.
 */
function seedInbox(
  ids: number[],
  scope: string = 'social',
  make: (id: number) => { id: number } = inboxRow,
): void {
  client().setQueryData(queryKeys.notifications.list({ scope }), {
    pages: [{ items: ids.map(make), next_cursor: 'cursor-1' }],
    pageParams: [null],
  });
}

function cachedInbox(scope: string = 'social'): CachedInbox {
  return client().getQueryData(queryKeys.notifications.list({ scope })) as CachedInbox;
}

function isInvalidated(key: readonly unknown[]): boolean {
  return client().getQueryState(key)?.isInvalidated === true;
}

beforeEach(() => {
  FakeSocket.reset();
  captured = null;
  // jsdom's WebSocket would attempt a real connection; the fake records instead.
  vi.stubGlobal('WebSocket', FakeSocket);
  clearTokens();
  toastMessage.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<RealtimeBridge> — an inbox notification', () => {
  it('prepends the pushed row to the first page without dropping the cursor', () => {
    const open = mount();
    seedInbox([11]);

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(12) });

    const inbox = cachedInbox();
    expect(inbox.pages).toHaveLength(1);
    expect(inbox.pages[0]?.items.map((item) => item.id)).toEqual([12, 11]);
    // The anchor must survive, or the next "load more" restarts the list.
    expect(inbox.pages[0]?.next_cursor).toBe('cursor-1');
  });

  it('ignores a row whose id is already cached', () => {
    const open = mount();
    seedInbox([11]);

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(11) });

    expect(cachedInbox().pages[0]?.items).toHaveLength(1);
  });

  it('invalidates the unread badge instead of guessing the new count', async () => {
    const open = mount();
    const unreadKey = queryKeys.notifications.unreadCount();
    client().setQueryData(unreadKey, { unread: 4 });

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(12) });

    await waitFor(() => expect(isInvalidated(unreadKey)).toBe(true));
    // Untouched until the refetch lands: `unread` counts rows past the loaded pages.
    expect(client().getQueryData(unreadKey)).toEqual({ unread: 4 });
  });

  it('toasts the copy the inbox row would have shown', () => {
    const open = mount();

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(12) });

    expect(toastMessage).toHaveBeenCalledWith('New notification', {
      description: 'User 23 started following you',
    });
  });

  it('routes an admin_new_user row to the staff inbox and nowhere else', async () => {
    const open = mount();
    seedInbox([11]);
    seedInbox([21], 'system', systemRow);
    const socialKey = queryKeys.notifications.unreadCount('social');
    const systemKey = queryKeys.notifications.unreadCount('system');
    client().setQueryData(socialKey, { unread: 4 });
    client().setQueryData(systemKey, { unread: 2 });

    deliver(open, { type: 'notification', ts: TS, data: systemRow(22) });

    // The frame carries no scope, so the type has to decide: staff traffic must
    // never appear among the recipient's follows and likes.
    expect(cachedInbox('system').pages[0]?.items.map((item) => item.id)).toEqual([22, 21]);
    expect(cachedInbox('social').pages[0]?.items.map((item) => item.id)).toEqual([11]);

    // Only the staff badge is stale; the personal one did not move.
    await waitFor(() => expect(isInvalidated(systemKey)).toBe(true));
    expect(isInvalidated(socialKey)).toBe(false);
  });

  it('leaves a person-to-person row out of the staff inbox', () => {
    const open = mount();
    seedInbox([11]);
    seedInbox([21], 'system', systemRow);

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(12) });

    expect(cachedInbox('social').pages[0]?.items.map((item) => item.id)).toEqual([12, 11]);
    expect(cachedInbox('system').pages[0]?.items.map((item) => item.id)).toEqual([21]);
  });
});

describe('<RealtimeBridge> — the kind-tagged payloads', () => {
  it('invalidates the room messages and the room list for chat_message', async () => {
    const open = mount();
    const messagesKey = queryKeys.chat.messages(601);
    const roomsKey = queryKeys.chat.rooms();
    client().setQueryData(messagesKey, { pages: [], pageParams: [null] });
    client().setQueryData(roomsKey, []);

    deliver(open, {
      type: 'notification',
      ts: TS,
      data: {
        kind: 'chat_message',
        room_id: 601,
        sender_id: 23,
        message: {
          id: 9001,
          room_id: 601,
          sender_id: 23,
          body: 'ping',
          created_at: TS,
        },
      },
    });

    await waitFor(() => expect(isInvalidated(messagesKey)).toBe(true));
    expect(isInvalidated(roomsKey)).toBe(true);
    // A chat frame is not an inbox row and must not toast.
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it('toasts a resolved report without writing any cache entry', () => {
    const open = mount();
    seedInbox([11]);
    const before = cachedInbox();

    deliver(open, {
      type: 'notification',
      ts: TS,
      data: {
        kind: 'report_resolved',
        report_id: 7,
        status: 'resolved',
        target_type: 'post',
        target_id: 5,
      },
    });

    expect(toastMessage).toHaveBeenCalledWith('A report you filed was resolved', {
      description: 'Resolved',
    });
    expect(cachedInbox()).toEqual(before);
  });

  it('still toasts when the status has no copy of its own', () => {
    const open = mount();

    deliver(open, {
      type: 'notification',
      ts: TS,
      data: {
        kind: 'report_resolved',
        report_id: 7,
        status: 'reopened',
        target_type: 'post',
        target_id: 5,
      },
    });

    // No raw enum leaks into the UI: the description is simply omitted.
    expect(toastMessage).toHaveBeenCalledWith('A report you filed was resolved', {
      description: undefined,
    });
  });
});

describe('<RealtimeBridge> — unread_count', () => {
  it('applies a scoped absolute count to that badge only', () => {
    const open = mount();
    const socialKey = queryKeys.notifications.unreadCount('social');
    const systemKey = queryKeys.notifications.unreadCount('system');
    client().setQueryData(socialKey, { unread: 4 });
    client().setQueryData(systemKey, { unread: 2 });

    deliver(open, { type: 'unread_count', ts: TS, data: { unread: 7, scope: 'social' } });

    expect(client().getQueryData(socialKey)).toEqual({ unread: 7 });
    // An absolute is per counter; clearing one screen must not move the other.
    expect(client().getQueryData(systemKey)).toEqual({ unread: 2 });
  });

  it('refetches rather than guess when the frame names no counter', async () => {
    const open = mount();
    const socialKey = queryKeys.notifications.unreadCount('social');
    client().setQueryData(socialKey, { unread: 4 });

    deliver(open, { type: 'unread_count', ts: TS, data: { unread: 3 } });

    // Which badge does 3 belong to? Unknowable, so the number is not trusted.
    await waitFor(() => expect(isInvalidated(socialKey)).toBe(true));
    expect(client().getQueryData(socialKey)).toEqual({ unread: 4 });
  });

  it('refetches on a delta rather than doing the arithmetic itself', async () => {
    const open = mount();
    const unreadKey = queryKeys.notifications.unreadCount();
    client().setQueryData(unreadKey, { unread: 4 });

    deliver(open, { type: 'unread_count', ts: TS, data: { unread_delta: 1 } });

    await waitFor(() => expect(isInvalidated(unreadKey)).toBe(true));
    // A delta the client cannot reconcile must never become a guessed number.
    expect(client().getQueryData(unreadKey)).toEqual({ unread: 4 });
  });
});

describe('<RealtimeBridge> — Bangla copy', () => {
  it('toasts in the active locale', () => {
    const open = mount('bn');

    deliver(open, { type: 'notification', ts: TS, data: inboxRow(12) });

    expect(toastMessage).toHaveBeenCalledWith('নতুন নোটিফিকেশন', {
      description: 'ব্যবহারকারী 23 আপনাকে ফলো করা শুরু করেছেন',
    });
  });
});
