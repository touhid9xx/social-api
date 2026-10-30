import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTokens } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { adminProfile, followStatus } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { FollowButton } from './follow-button';

/**
 * The follow control.
 *
 * Three of the four behaviours here are feature decisions, not styling:
 *
 *  - own profile renders NOTHING, because following yourself is a guaranteed
 *    `CANNOT_FOLLOW_SELF` and a disabled button still invites the click;
 *  - `is_blocked_by_me` also renders nothing — following would silently unblock,
 *    which is not what the button means;
 *  - `has_blocked_me` renders COPY instead, because a vanishing control reads as
 *    a bug rather than an answer.
 *
 * The fourth is that the mutation takes the DESIRED state, so the label flips
 * optimistically and rolls back on failure.
 *
 * (নিজের প্রোফাইলে বা ব্লক করা হলে বাটনটাই বসে না; ব্লকড-বাই-দেম হলে লেখা দেখায়।)
 */

const STATUS_PATH = '*/api/v1/users/:user_id/follow-status';
const FOLLOW_PATH = '*/api/v1/follows/:user_id';

function errorBody(error: string, status: number, path: string, detail = 'test'): ApiErrorBody {
  return { error, status, detail, path, request_id: 'req-1' };
}

/** Records the reads so a "renders nothing" test can prove the queries ran. */
function trackReads() {
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

      return HttpResponse.json(status);
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
});

describe('FollowButton', () => {
  it('renders nothing while the two reads are in flight', () => {
    renderWithProviders(<FollowButton userId={22} name="Alice Rahman" />);

    // Showing "Follow" before the status is known would flash the wrong state on
    // every page load and invite a click that races the answer. `container` can
    // never be empty here — `renderWithProviders` mounts the QueryProvider — so
    // the invariant is asserted on the button role instead.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers Follow for a user who is not followed yet', async () => {
    renderWithProviders(<FollowButton userId={22} name="Alice Rahman" />);

    const button = await screen.findByRole('button', { name: 'Follow Alice Rahman' });
    expect(button).toHaveTextContent('Follow');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers Unfollow for a user already followed', async () => {
    renderWithProviders(<FollowButton userId={23} name="Bashir Hossain" />);

    const button = await screen.findByRole('button', { name: 'Unfollow Bashir Hossain' });
    expect(button).toHaveTextContent('Following');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders nothing on your own profile', async () => {
    const seen = trackReads();
    renderWithProviders(<FollowButton userId={21} name="Admin" />);

    // The button must be absent *after* both queries answered — the public
    // profile carries no "is this me" flag, so `useMe` is the only evidence.
    // Asserting the request count proves the queries ran rather than merely
    // not having rendered yet.
    await waitFor(() => {
      expect(seen).toHaveLength(2);
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when you are the one who blocked them', async () => {
    const seen = trackReads();
    server.use(
      http.get(STATUS_PATH, ({ params }) => {
        seen.push(`/users/${String(params.user_id)}/blocked`);
        return HttpResponse.json({
          is_following: false,
          is_followed_by: false,
          is_blocked_by_me: true,
          has_blocked_me: false,
          is_muted_by_me: false,
        });
      }),
    );

    renderWithProviders(<FollowButton userId={22} name="Alice Rahman" />);

    // Following would unblock them as a side effect — that belongs on the block
    // list, not behind a follow button.
    await waitFor(() => {
      expect(seen).toHaveLength(2);
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains itself instead of hiding when they blocked you', async () => {
    renderWithProviders(<FollowButton userId={24} name="User 24" />);

    // Every follow attempt would be rejected; copy is the honest answer, and a
    // silent disappearance would look like a defect.
    expect(await screen.findByText("You can't follow this account.")).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('flips optimistically and posts the desired state once', async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    server.use(
      http.post(FOLLOW_PATH, ({ request }) => {
        posts.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<FollowButton userId={22} name="Alice Rahman" />);

    await user.click(await screen.findByRole('button', { name: 'Follow Alice Rahman' }));

    // The mutation is given `{ following: true }`, not "toggle", so a double tap
    // cannot fire two follows — here it must have sent exactly one request.
    const button = await screen.findByRole('button', { name: 'Unfollow Alice Rahman' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(posts).toEqual(['/api/v1/follows/22']);
  });

  it('rolls back when the write fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(FOLLOW_PATH, () =>
        HttpResponse.json(errorBody('PROFILE_NOT_FOUND', 404, '/api/v1/follows/22'), {
          status: 404,
        }),
      ),
    );

    renderWithProviders(<FollowButton userId={22} name="Alice Rahman" />);

    await user.click(await screen.findByRole('button', { name: 'Follow Alice Rahman' }));

    // The optimistic patch is reverted to the snapshot, so the button must not
    // be left claiming a follow the server refused.
    const button = await screen.findByRole('button', { name: 'Follow Alice Rahman' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders Bangla labels under the bn locale', async () => {
    renderWithProviders(<FollowButton userId={23} name="Bashir Hossain" />, { locale: 'bn' });

    const button = await screen.findByRole('button', { name: 'Bashir Hossain-কে আনফলো করুন' });
    expect(button).toHaveTextContent('ফলো করছেন');
  });
});
