import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { NotificationPage } from '@/lib/api/notifications';
import { renderWithProviders } from '@/lib/testing/render';
import { FIXTURE_NOW, notifications } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { NotificationList } from './notification-list';

/**
 * The notification inbox.
 *
 * Three behaviours carry the design, and each one is a decision rather than an
 * accident:
 *
 *  - **Only `post` targets link.** A `comment` target carries the COMMENT id
 *    (linking it opens the wrong post) and a `user` target would need a username
 *    the contract does not expose. Those rows render unlinked on purpose.
 *  - **Marking one row read patches the cache**; it must NOT invalidate the list,
 *    because a refetch would drop every page the user has scrolled back to the
 *    top. The badge query is invalidated instead — that count is not derivable
 *    from the loaded pages.
 *  - **A failed next page is not a page-level error.** Rows already read stay on
 *    screen; only "nothing loaded at all" earns the full-page alert.
 *
 * (শুধু পোস্ট-টার্গেট লিঙ্ক হয়; এক সারি পঠিত করলে তালিকা রিফেচ হয় না।)
 */

const LIST_PATH = '/api/v1/notifications';
const READ_ALL_PATH = `${LIST_PATH}/read-all`;

const ERROR_BODY: ApiErrorBody = {
  error: 'NOTIFICATIONS_UNAVAILABLE',
  status: 404,
  detail: 'test',
  path: LIST_PATH,
  request_id: 'test-request-id',
};

/**
 * `NotificationView` exists in two spellings, exactly like `CommentView`: the
 * OpenAPI schema the client is typed from narrows `type` and `target_type` to
 * literal unions, while the hand-mirrored contract the fixtures are built
 * against types them as bare `string`. Narrow once, here, rather than casting at
 * every assertion.
 */
type ApiNotification = NotificationPage['items'][number];

const INBOX: ApiNotification[] = notifications.map((notification) => ({
  ...notification,
  type: notification.type as ApiNotification['type'],
  target_type: notification.target_type as ApiNotification['target_type'],
}));

function row(id: number): ApiNotification {
  const found = INBOX.find((item) => item.id === id);
  if (!found) throw new Error(`fixture notification ${String(id)} is missing`);
  return found;
}

function serveInbox(items: ApiNotification[], next: string | null = null) {
  server.use(
    http.get(`*${LIST_PATH}`, () => {
      const body: NotificationPage = { items, next_cursor: next };
      return HttpResponse.json(body);
    }),
  );
}

describe('NotificationList', () => {
  it('renders every row with the actor resolved and a total type map', async () => {
    renderWithProviders(<NotificationList />);

    expect(await screen.findByText('Alice Rahman liked your post')).toBeInTheDocument();
    expect(screen.getByText('Bashir Hossain started following you')).toBeInTheDocument();
    // Actor 24 has a null `display_name`: the sentence must fall back to
    // "User {id}" rather than render a nameless line.
    expect(screen.getByText('User 24 commented on your post')).toBeInTheDocument();
    expect(screen.getByText('Alice Rahman liked your comment')).toBeInTheDocument();

    expect(screen.getAllByRole('listitem')).toHaveLength(INBOX.length);
    expect(screen.getByText('4 notifications')).toBeInTheDocument();
    // Three of the four fixture rows are unread, matching the badge count.
    expect(screen.getAllByText('Unread')).toHaveLength(3);
  });

  it('links post targets only, leaving comment and user targets unlinked', async () => {
    renderWithProviders(<NotificationList />);

    await screen.findByText('Alice Rahman liked your post');

    // 301 (like_post) and 303 (comment_post) both target post 101.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/posts/101');

    // A comment target holds the COMMENT id; linking it would open the wrong
    // post, so the row is deliberately not an anchor.
    expect(screen.getByText('Alice Rahman liked your comment').closest('a')).toBeNull();
    expect(screen.getByText('Bashir Hossain started following you').closest('a')).toBeNull();
  });

  it('marks one row read in place instead of refetching the inbox', async () => {
    let listCalls = 0;
    let readCalls = 0;

    server.use(
      http.get(`*${LIST_PATH}`, () => {
        listCalls += 1;
        const body: NotificationPage = { items: INBOX, next_cursor: null };
        return HttpResponse.json(body);
      }),
      http.post(`*${LIST_PATH}/:notif_id/read`, ({ params }) => {
        readCalls += 1;
        return HttpResponse.json({
          ...row(Number(params.notif_id)),
          is_read: true,
          read_at: FIXTURE_NOW,
        });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<NotificationList />);

    await screen.findByText('Alice Rahman liked your post');
    expect(screen.getAllByText('Unread')).toHaveLength(3);

    const [firstMarkRead] = screen.getAllByRole('button', { name: 'Mark as read' });
    if (!firstMarkRead) throw new Error('expected a mark-read control on the first unread row');
    await user.click(firstMarkRead);

    await waitFor(() => {
      expect(screen.getAllByText('Unread')).toHaveLength(2);
    });

    expect(readCalls).toBe(1);
    // The whole point: the reply is applied to the cache entry, not refetched.
    expect(listCalls).toBe(1);
  });

  it('marks every unread row read and agrees with the server afterwards', async () => {
    // The shared fixture is never mutated by the default handlers, so this test
    // owns its own stateful inbox: the point is the cache rewrite PLUS the
    // invalidation that makes the next read agree with what was written.
    let rows = INBOX.map((notification) => ({ ...notification }));

    server.use(
      http.get(`*${LIST_PATH}`, () => {
        const body: NotificationPage = { items: rows, next_cursor: null };
        return HttpResponse.json(body);
      }),
      http.post(`*${READ_ALL_PATH}`, () => {
        const updated = rows.filter((notification) => !notification.is_read).length;
        rows = rows.map((notification) =>
          notification.is_read
            ? notification
            : { ...notification, is_read: true, read_at: FIXTURE_NOW },
        );
        return HttpResponse.json({ updated });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<NotificationList />);

    await screen.findByText('Alice Rahman liked your post');
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => {
      expect(screen.queryAllByText('Unread')).toHaveLength(0);
    });
    // Nothing left to mark, so the control removes itself rather than sitting
    // there as a no-op.
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(INBOX.length);
  });

  it('deletes a row and leaves the rest of the inbox alone', async () => {
    // Stateful on purpose: the component removes the row from the cache, and a
    // refetch must not resurrect it.
    let rows = INBOX.map((notification) => ({ ...notification }));
    let deleted: string | null = null;

    server.use(
      http.get(`*${LIST_PATH}`, () => {
        const body: NotificationPage = { items: rows, next_cursor: null };
        return HttpResponse.json(body);
      }),
      http.delete(`*${LIST_PATH}/:notif_id`, ({ params }) => {
        deleted = String(params.notif_id);
        rows = rows.filter((notification) => notification.id !== Number(params.notif_id));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<NotificationList />);

    await screen.findByText('Bashir Hossain started following you');

    // Row 302 — the follow notification.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete notification' });
    const followDelete = deleteButtons[1];
    if (!followDelete) throw new Error('expected a delete control on the follow row');
    await user.click(followDelete);

    await waitFor(() => {
      expect(screen.queryByText('Bashir Hossain started following you')).toBeNull();
    });
    expect(deleted).toBe('302');
    expect(screen.getAllByRole('listitem')).toHaveLength(INBOX.length - 1);
    expect(screen.getByText('Alice Rahman liked your post')).toBeInTheDocument();
  });

  it('shows the empty state for an empty inbox', async () => {
    serveInbox([]);

    renderWithProviders(<NotificationList />);

    expect(await screen.findByText('Nothing to catch up on')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows a page-level error whose retry recovers the inbox', async () => {
    let attempt = 0;
    server.use(
      http.get(`*${LIST_PATH}`, () => {
        attempt += 1;
        if (attempt === 1) return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });

        const body: NotificationPage = { items: INBOX, next_cursor: null };
        return HttpResponse.json(body);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<NotificationList />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your notifications")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Alice Rahman liked your post')).toBeInTheDocument();
  });

  it('reports a failed next page without losing the rows already read', async () => {
    server.use(
      http.get(`*${LIST_PATH}`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');

        // A 4xx is never retried, so the assertion waits on the component
        // rather than on the retry schedule.
        if (cursor) return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });

        const body: NotificationPage = { items: [row(301)], next_cursor: '1' };
        return HttpResponse.json(body);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<NotificationList />);

    expect(await screen.findByText('Alice Rahman liked your post')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(
      await screen.findByText("Couldn't load more notifications. Try again."),
    ).toBeInTheDocument();
    // The failed page must not replace the inbox with a page-level alert.
    expect(screen.getByText('Alice Rahman liked your post')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your notifications")).toBeNull();
  });

  it('renders Bangla copy under the bn locale', async () => {
    serveInbox([]);

    renderWithProviders(<NotificationList />, { locale: 'bn' });

    expect(await screen.findByText('দেখার মতো কিছু নেই')).toBeInTheDocument();
  });
});
