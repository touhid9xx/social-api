import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { notifications, unreadNotificationCount } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import {
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications';

/**
 * The notification inbox client.
 *
 * Three things are not obvious from the signatures and are pinned here:
 *  - the first page sends NO cursor (a `null` would reach the backend as the
 *    literal string "null") and an opaque cursor round-trips untouched;
 *  - `unread_only` filters BEFORE the page is sliced, which is what keeps
 *    `next_cursor` meaningful — a short page must never mean "the filter lied";
 *  - a failed read is an `AppApiError`, never a raw envelope.
 *
 * (প্রথম পাতায় cursor যায় না; অপঠিত ফিল্টার আগে, তারপর পাতা কাটা হয়।)
 */

const LIST_PATH = '*/api/v1/notifications';
const READ_ALL_PATH = '*/api/v1/notifications/read-all';
const DELETE_PATH = '*/api/v1/notifications/:notif_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getNotifications', () => {
  it('returns the first page of the inbox', async () => {
    const page = await getNotifications();

    expect(page.items).toHaveLength(notifications.length);
    expect(page.items[0]?.id).toBe(notifications[0]?.id);
    expect(page.next_cursor).toBeNull();
  });

  it('omits the cursor on the first page and sends the limit', async () => {
    let search = '';
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    await getNotifications({ limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded as the string "null".
    expect(params.has('cursor')).toBe(false);
  });

  it('passes an opaque cursor back verbatim', async () => {
    let cursor: string | null = null;
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    // The cursor is opaque: this test never parses it, it only proves the client
    // does not either.
    await getNotifications({ cursor: 'eyJvZmZzZXQiOjIwfQ', limit: 2 });

    expect(cursor).toBe('eyJvZmZzZXQiOjIwfQ');
  });

  it('sends unread_only and honours it before slicing the page', async () => {
    let search = '';
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        search = new URL(request.url).search;
        const rows = notifications.filter((row) => !row.is_read);
        // Two of the three unread rows, but `next_cursor` must point past the
        // FILTERED list, not past the unfiltered one.
        return HttpResponse.json({ items: rows.slice(0, 2), next_cursor: '2' });
      }),
    );

    const page = await getNotifications({ unreadOnly: true, limit: 2 });

    expect(new URLSearchParams(search).get('unread_only')).toBe('true');
    expect(page.items.every((row) => !row.is_read)).toBe(true);
    expect(page.next_cursor).toBe('2');
  });

  it('normalises a failure into an AppApiError', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(errorBody('INTERNAL_ERROR', 500, '/api/v1/notifications'), {
          status: 500,
        }),
      ),
    );

    const error = await getNotifications().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('INTERNAL_ERROR');
  });
});

describe('getUnreadCount', () => {
  it('asks the dedicated endpoint rather than counting a page', async () => {
    const count = await getUnreadCount();

    expect(count.unread).toBe(unreadNotificationCount.unread);
    // The badge number must match what the inbox shows, or the two disagree.
    expect(count.unread).toBe(notifications.filter((row) => !row.is_read).length);
  });
});

describe('markNotificationRead', () => {
  it('returns the whole updated row so one cache entry can be patched', async () => {
    const updated = await markNotificationRead(301);

    expect(updated.id).toBe(301);
    expect(updated.is_read).toBe(true);
    expect(updated.read_at).not.toBeNull();
  });

  it('surfaces an unknown id as NOTIFICATION_NOT_FOUND', async () => {
    const error = await markNotificationRead(999_999).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('NOTIFICATION_NOT_FOUND');
    expect(error.isClientError).toBe(true);
  });
});

describe('markAllNotificationsRead', () => {
  it('reports how many rows actually flipped', async () => {
    const result = await markAllNotificationsRead();

    expect(result.updated).toBe(notifications.filter((row) => !row.is_read).length);
  });

  it('treats zero updates as a normal answer, not an error', async () => {
    server.use(http.post(READ_ALL_PATH, () => HttpResponse.json({ updated: 0 })));

    await expect(markAllNotificationsRead()).resolves.toEqual({ updated: 0 });
  });
});

describe('deleteNotification', () => {
  it('resolves on a 204 with no body', async () => {
    server.use(http.delete(DELETE_PATH, () => new HttpResponse(null, { status: 204 })));

    await expect(deleteNotification(301)).resolves.toBeUndefined();
  });

  it('calls the notification path, not the read path', async () => {
    const paths: string[] = [];
    server.use(
      http.delete(DELETE_PATH, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await deleteNotification(302);

    expect(paths).toEqual(['/api/v1/notifications/302']);
  });
});

// Dead-code guard: the paths above must be the ones the handlers serve, or the
// suite would pass against a mock nobody uses.
describe('handler wiring', () => {
  it('serves the inbox from the shared fixture', async () => {
    const page = await getNotifications();

    expect(page.items.map((row) => row.id)).toEqual(notifications.map((row) => row.id));
  });

  it('serves the unread count from the same fixture set', async () => {
    const { unread } = await getUnreadCount();
    const page = await getNotifications();

    expect(page.items.filter((row) => !row.is_read)).toHaveLength(unread);
  });

  it('keeps the unread-count path ahead of the list handler', async () => {
    // MSW takes the first match: if `GET /notifications` swallowed
    // `/notifications/unread-count`, this would be a page and not a count.
    // The shape assertion is the point — `{ unread }`, never `{ items }`.
    const count = await getUnreadCount();

    expect(count).toEqual({ unread: unreadNotificationCount.unread });
  });
});
