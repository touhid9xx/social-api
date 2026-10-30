import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { RoomList } from './room-list';

/**
 * The conversation list.
 *
 * The shape of this screen is dictated by the endpoint, so the tests pin the two
 * facts that make it look odd:
 *
 *  - `GET /chat/rooms` is a **bare array** ordered by activity with no cursor, so
 *    there is no "load more" and no unread badge (unread is a per-room call).
 *  - `RoomView` carries no participants, so a direct room is named by asking for
 *    its **members** and taking the one that is not me. A group room is named by
 *    its `title`.
 *
 * Room 601 is the direct room (members: admin 21 + Alice 22) and room 602 is the
 * three-member group "Design crew".
 */

const ROOMS_PATH = '*/api/v1/chat/rooms';

const ERROR_BODY: ApiErrorBody = {
  error: 'CHAT_UNAVAILABLE',
  status: 429,
  detail: 'test',
  path: '/api/v1/chat/rooms',
  request_id: 'test-request-id',
};

describe('RoomList', () => {
  it('names a direct room after its peer and a group room after its title', async () => {
    renderWithProviders(<RoomList />);

    expect(await screen.findByText('Alice Rahman')).toBeInTheDocument();
    expect(screen.getByText('Design crew')).toBeInTheDocument();

    // 601 has no title at all — the name came from resolving the member list.
    expect(screen.getByRole('link', { name: /Alice Rahman/ })).toHaveAttribute(
      'href',
      '/messages/601',
    );
    expect(screen.getByRole('link', { name: /Design crew/ })).toHaveAttribute(
      'href',
      '/messages/602',
    );

    // The kind line distinguishes the two: `directKind` is a fixed string, the
    // group one is a plural count read off the member list.
    expect(screen.getByText('Direct message')).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('keeps a direct room on the list when its members cannot be read', async () => {
    // Without the member list there is no peer to name, and the row must degrade
    // to the generic label rather than vanish or render an empty name.
    server.use(
      http.get('*/api/v1/chat/rooms/:room_id/members', () =>
        HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status }),
      ),
    );

    renderWithProviders(<RoomList />);

    expect(await screen.findByRole('link', { name: /Direct message/ })).toHaveAttribute(
      'href',
      '/messages/601',
    );
    // The fallback label and the kind line are the same string, hence two.
    expect(screen.getAllByText('Direct message')).toHaveLength(2);
    expect(screen.getByText('Design crew')).toBeInTheDocument();
  });

  it('shows the empty state instead of an empty list', async () => {
    server.use(http.get(ROOMS_PATH, () => HttpResponse.json([])));

    renderWithProviders(<RoomList />);

    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
    // The hint's apostrophe is typographic in the catalog, so match loosely.
    expect(screen.getByText(/profile to start a chat/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows an error whose retry recovers the list', async () => {
    let attempt = 0;

    server.use(
      http.get(ROOMS_PATH, () => {
        attempt += 1;
        // 429 rather than 5xx: the shared query client retries a 5xx twice with
        // backoff, and this assertion should wait on the component, not a timer.
        if (attempt === 1) return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });

        return HttpResponse.json([
          {
            id: 601,
            type: 'direct',
            title: null,
            created_at: '2026-01-10T09:00:00.000Z',
            updated_at: '2026-01-15T10:00:00.000Z',
          },
        ]);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<RoomList />);

    expect(await screen.findByText("Couldn't load your conversations")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Alice Rahman')).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    server.use(http.get(ROOMS_PATH, () => HttpResponse.json([])));

    renderWithProviders(<RoomList />, { locale: 'bn' });

    expect(await screen.findByText('এখনও কোনো কথোপকথন নেই')).toBeInTheDocument();
  });
});
