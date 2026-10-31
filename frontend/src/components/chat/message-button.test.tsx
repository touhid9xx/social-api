import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens } from '@/lib/api';
import type { FollowStatus } from '@/lib/api/follows';
import { renderWithProviders } from '@/lib/testing/render';
import { adminProfile, directRoom, followStatus } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { MessageButton } from './message-button';

/**
 * The only door into a conversation.
 *
 * `chat.rooms.emptyHint` tells the reader to open someone's profile to start a
 * chat, so this control is what that sentence points at — if it disappears for a
 * state the backend would have accepted, the feature has no entry point at all.
 * The tests therefore pin both halves:
 *
 *  - the two states that hide it (own profile, a block in either direction),
 *    each proven to have actually resolved rather than still loading;
 *  - the happy path landing on the room the endpoint returned, not on an id we
 *    guessed locally — `POST /chat/rooms/direct` is find-or-create, so the server
 *    owns which room a pair maps to.
 *
 * (নিজের প্রোফাইলে বা ব্লক থাকলে বাটন বসে না; অন্যথায় সার্ভারের দেওয়া রুমে যায়।)
 */

const { push, toastError } = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

const STATUS_PATH = '*/api/v1/users/:user_id/follow-status';
const DIRECT_PATH = '*/api/v1/chat/rooms/direct';

function errorBody(error: string, status: number, path: string, detail = 'test'): ApiErrorBody {
  return { error, status, detail, path, request_id: 'req-1' };
}

/**
 * Records the reads so a "renders nothing" test can prove the queries ran.
 *
 * `overrides` flips flags on the fixture rather than registering a second handler
 * for the same path: `server.use` prepends, so a later override would shadow this
 * one and `seen` would stay empty — the absence assertion would then pass against
 * a component that had not rendered at all yet.
 */
function trackReads(overrides: Record<number, Partial<FollowStatus>> = {}) {
  const seen: string[] = [];

  server.use(
    http.get(STATUS_PATH, ({ params }) => {
      const id = Number(params.user_id);
      seen.push(`/users/${String(id)}/follow-status`);

      const status = followStatus[id];
      if (!status) {
        return HttpResponse.json(
          errorBody('PROFILE_NOT_FOUND', 404, `/api/v1/users/${String(id)}/follow-status`),
          { status: 404 },
        );
      }

      return HttpResponse.json({ ...status, ...overrides[id] });
    }),
    http.get('*/api/v1/users/me', () => {
      seen.push('/users/me');
      return HttpResponse.json(adminProfile);
    }),
  );

  return seen;
}

beforeEach(() => {
  clearTokens();
  push.mockClear();
  toastError.mockClear();
});

describe('MessageButton', () => {
  it('renders nothing while the two reads are in flight', () => {
    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    // Rendering early would offer a conversation before we know whether a block
    // forbids it, i.e. a button whose only outcome is an error toast.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing on your own profile, where the header shows Edit instead', async () => {
    // `adminProfile.user_id` is 21 — the signed-in user's own id.
    const seen = trackReads();

    renderWithProviders(<MessageButton userId={adminProfile.user_id} name="Admin" />);

    await waitFor(() => expect(seen).toContain('/users/me'));
    // Both queries resolved, so the absence is a decision, not a pending render.
    expect(seen).toContain(`/users/${String(adminProfile.user_id)}/follow-status`);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when I have blocked them', async () => {
    const seen = trackReads({ 22: { is_blocked_by_me: true } });

    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    // Wait for the status to land before asserting absence, or the assertion
    // would pass against a component that simply had not rendered yet.
    await waitFor(() => expect(seen).toContain('/users/22/follow-status'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when they have blocked me', async () => {
    const seen = trackReads({ 22: { has_blocked_me: true } });

    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    // `CHAT_BLOCKED` (403) would reject the write; the block list, not a button,
    // is where this state belongs.
    await waitFor(() => expect(seen).toContain('/users/22/follow-status'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a labelled Message control for someone else', async () => {
    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    const button = await screen.findByRole('button', { name: 'Message Alice Rahman' });
    // Icon-only would be unreadable to a screen reader; the visible label is the
    // accessible name's tail, so both must be present.
    expect(button).toHaveTextContent('Message');
  });

  it('opens the server-chosen direct room and navigates into it', async () => {
    let body: unknown = null;
    server.use(
      http.post(DIRECT_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(directRoom, { status: 201 });
      }),
    );

    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Message Alice Rahman' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/messages/${String(directRoom.id)}`));
    // The contract's snake_case field, not the component's camelCase prop.
    expect(body).toEqual({ other_user_id: 22 });
  });

  it('surfaces a refused conversation instead of navigating', async () => {
    server.use(
      http.post(DIRECT_PATH, () =>
        HttpResponse.json(errorBody('CHAT_BLOCKED', 403, '/api/v1/chat/rooms/direct'), {
          status: 403,
        }),
      ),
    );

    renderWithProviders(<MessageButton userId={22} name="Alice Rahman" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Message Alice Rahman' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    // Translated copy for `errors.chatBlocked` — never the raw code.
    expect(toastError).toHaveBeenCalledWith('You cannot message this person.');
    expect(push).not.toHaveBeenCalled();
  });

  it('renders Bangla labels under the bn locale', async () => {
    renderWithProviders(<MessageButton userId={22} name="Alice" />, { locale: 'bn' });

    const button = await screen.findByRole('button', { name: 'Alice-কে বার্তা পাঠান' });
    expect(button).toHaveTextContent('বার্তা');
  });
});
