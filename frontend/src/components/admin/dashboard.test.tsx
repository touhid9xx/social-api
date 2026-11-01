import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { DashboardOverview } from '@/lib/api/dashboard';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { Dashboard } from './dashboard';

/**
 * The admin overview — `GET /api/v1/admin/dashboard`.
 *
 * The assertions follow the four things this screen can get wrong:
 *
 *  - **Sections vs. counters.** One response carries five sections, so a panel
 *    that silently dropped `storage` or swapped two counters would still "look
 *    like a dashboard". Each section is asserted through its own heading.
 *  - **`available: false` is not zero.** The server reports traffic/workers as
 *    unavailable rather than fabricating zeros, and the screen has to say so —
 *    a wall of `0`s is the exact failure this contract exists to prevent.
 *  - **`403` is an answer, not a failure.** The client has no role to pre-check
 *    (`/users/me` carries none) and `query-provider.tsx` skips 4xx retries, so a
 *    non-admin settles into "admins only" after a single request — and must not
 *    be offered a retry that can only fail again.
 *  - **The window is query identity.** Changing it has to reach the wire as
 *    `window_days`, otherwise every window silently renders the 30-day numbers.
 *
 * (৩০৩ মানে "শুধু অ্যাডমিন"; `available: false` মানে "কোনো তথ্য নেই", শূন্য নয়।)
 */

const DASHBOARD_PATH = '*/api/v1/admin/dashboard';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/**
 * A populated overview.
 *
 * Deliberately mixes non-zero values that differ per section: a component that
 * rendered the same counter for "Accounts" and "Posts" would pass a fixture of
 * all-equal numbers but fails here.
 */
function overview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    window_days: 30,
    generated_at: '2026-02-20T10:00:00Z',
    users: {
      // 1204 and 1100, not 1204 and 1180: both compact to "1.2K", which would
      // make the counter assertion below ambiguous.
      total: 1204,
      active: 1100,
      verified: 903,
      staff: 3,
      deleted: 24,
      new_in_window: 87,
      new_previous_window: 64,
      active_last_24h: 41,
      active_last_7d: 230,
      active_last_30d: 812,
      signups_by_day: [
        { day: '2026-02-18', value: 12 },
        { day: '2026-02-19', value: 19 },
      ],
    },
    content: {
      posts: 5310,
      comments: 9120,
      likes: 24000,
      follows: 4100,
      chat_rooms: 320,
      messages: 51000,
      posts_in_window: 640,
      // Not 1200: that would render the same "1.2K" as `users.total` and make the
      // counter assertions ambiguous.
      comments_in_window: 1300,
      messages_in_window: 8100,
      activity_by_day: [{ day: '2026-02-19', value: 210 }],
    },
    storage: {
      total_bytes: 734003200,
      media_count: 421,
      image_bytes: 314572800,
      video_bytes: 419430400,
      users_with_media: 96,
      average_bytes_per_user: 7645866,
      orphan_count: 7,
      orphan_bytes: 1048576,
      top_consumers: [
        { user_id: 21, display_name: 'Ayesha Rahman', media_count: 44, total_bytes: 104857600 },
        { user_id: 31, display_name: null, media_count: 12, total_bytes: 5242880 },
      ],
    },
    traffic: {
      available: true,
      requests: 51230,
      authenticated_requests: 30110,
      unique_visitors: 2310,
      error_requests: 512,
      error_rate: 0.01,
      avg_latency_ms: 84,
      p95_latency_ms: 320,
      requests_by_day: [{ day: '2026-02-19', value: 1830 }],
      by_class: [
        { path_class: 'feed', requests: 21000, error_requests: 120, avg_latency_ms: 61 },
        { path_class: 'unheard-of', requests: 12, error_requests: 0, avg_latency_ms: 9 },
      ],
      regions: [
        { country: 'BD', city: 'Dhaka', timezone: 'Asia/Dhaka', requests: 1200, share: 0.52 },
        { country: null, city: null, timezone: null, requests: 1110, share: 0.48 },
      ],
    },
    workers: { available: true, queue_depth: 4 },
    ...overrides,
  };
}

/** Resolve the screen: wait for the People panel heading to replace the skeleton. */
async function ready(): Promise<void> {
  await screen.findByRole('heading', { name: 'People' });
}

/**
 * The value rendered next to a `Stat` label.
 *
 * Read as a label/value pair rather than by number alone: `formatCount` is
 * compact, so the same "1.2K" can legitimately appear under several counters and
 * a bare `getByText` would be ambiguous. This also asserts the pairing itself —
 * a swapped label/value would fail even with distinct numbers.
 */
function statValue(label: string): string {
  const term = screen.getByText(label);
  return term.nextElementSibling?.textContent ?? '';
}

describe('Dashboard', () => {
  it('renders every section from the single aggregate response', async () => {
    let reads = 0;
    server.use(
      http.get(DASHBOARD_PATH, () => {
        reads += 1;
        return HttpResponse.json(overview());
      }),
    );

    renderWithProviders(<Dashboard />);

    await ready();

    // Five sections, one request.
    expect(reads).toBe(1);
    for (const heading of ['People', 'Content', 'Storage', 'Traffic', 'Workers']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }

    // One counter per section, read as a label/value pair: a panel that dropped a
    // section, or that put a number under the wrong label, fails here.
    expect(statValue('Accounts')).toBe('1.2K');
    expect(statValue('Messages')).toBe('51K');
    expect(statValue('Files')).toBe('421');
    // "Signed in", not "Requests": the traffic table also has a `Requests` column
    // header, which would make the label lookup ambiguous.
    expect(statValue('Signed in')).toBe('30.1K');
    expect(statValue('Queued jobs')).toBe('4');

    // The window-locked counters carry the response's window, not a default.
    expect(statValue('New')).toBe('87');
    expect(screen.getByText('64 in the previous window')).toBeInTheDocument();

    // The window from the response, not the client's default guess.
    expect(
      screen.getByText('Registrations and sign-in activity over the last 30 days.'),
    ).toBeInTheDocument();

    // Storage is formatted in bytes, and a nameless consumer falls back to `User {id}`.
    expect(screen.getByText('Ayesha Rahman')).toBeInTheDocument();
    expect(screen.getByText('User 31')).toBeInTheDocument();

    // Endpoint families are labelled, but a bucket the frontend does not know is
    // printed verbatim rather than dropped from the table.
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('unheard-of')).toBeInTheDocument();

    // Regions: a null country is not rendered as the string "null".
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('BD · Dhaka')).toBeInTheDocument();

    // Workers panel is populated, so the queue counter is shown.
    expect(screen.getByText('Queued jobs')).toBeInTheDocument();
    expect(screen.queryByText('Queue depth unavailable')).not.toBeInTheDocument();
  });

  it('says "no data" instead of zero when traffic and workers are unavailable', async () => {
    const data = overview();
    server.use(
      http.get(DASHBOARD_PATH, () =>
        HttpResponse.json({
          ...data,
          // The server zero-fills these counters but sets `available: false`;
          // rendering the zeros would claim the instance served no requests.
          traffic: { ...data.traffic, available: false, requests: 0, unique_visitors: 0 },
          workers: { available: false, queue_depth: 0 },
        }),
      ),
    );

    renderWithProviders(<Dashboard />);

    await ready();

    expect(screen.getByText('No traffic data yet')).toBeInTheDocument();
    expect(screen.getByText('Queue depth unavailable')).toBeInTheDocument();

    // The traffic counters must not be on screen at all — not even as zeros.
    expect(screen.queryByText('Unique visitors')).not.toBeInTheDocument();
    expect(screen.queryByText('Queued jobs')).not.toBeInTheDocument();
    expect(screen.queryByText('Error rate')).not.toBeInTheDocument();
  });

  it('treats 403 as "admins only" and offers no retry', async () => {
    server.use(
      http.get(DASHBOARD_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/admin/dashboard'), { status: 403 }),
      ),
    );

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The overview is limited to administrators. If you think you should have access, ask an administrator.',
      ),
    ).toBeInTheDocument();

    // A retry here could only produce the same 403, so it must not be offered —
    // and the refusal must not borrow the generic failure copy either.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the overview")).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument();
  });

  it('sends the selected window as window_days', async () => {
    const user = userEvent.setup();
    const windows: string[] = [];

    server.use(
      http.get(DASHBOARD_PATH, ({ request }) => {
        const asked = new URL(request.url).searchParams.get('window_days') ?? '';
        windows.push(asked);
        return HttpResponse.json({ ...overview(), window_days: Number(asked) });
      }),
    );

    renderWithProviders(<Dashboard />);

    await ready();

    // The default is 30 days, and that is query identity, so it must be sent.
    expect(windows).toEqual(['30']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '90');

    // A new window is a new key, so the screen refetches rather than re-rendering
    // stale 30-day numbers under a 90-day label.
    await waitFor(() => expect(windows).toEqual(['30', '90']));
    expect(
      await screen.findByText('Registrations and sign-in activity over the last 90 days.'),
    ).toBeInTheDocument();
  });

  it('renders a retryable alert when the aggregate fails', async () => {
    // 429, not 500: `query-provider.tsx` retries 5xx twice with backoff, so the
    // alert would arrive seconds later and race `findBy`'s timeout.
    server.use(
      http.get(DASHBOARD_PATH, () =>
        HttpResponse.json(errorBody('RATE_LIMITED', 429, '/api/v1/admin/dashboard'), {
          status: 429,
        }),
      ),
    );

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("Couldn't load the overview")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // A transient failure is not a role problem.
    expect(screen.queryByText('Admins only')).not.toBeInTheDocument();
  });

  it('renders under the Bangla catalog', async () => {
    server.use(http.get(DASHBOARD_PATH, () => HttpResponse.json(overview())));

    renderWithProviders(<Dashboard />, { locale: 'bn' });

    await screen.findByRole('heading', { name: 'ব্যবহারকারী' });
    expect(screen.getByRole('heading', { name: 'কনটেন্ট' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ট্রাফিক' })).toBeInTheDocument();
    // Names are data, so they stay untranslated even under `bn`.
    expect(screen.getByText('Ayesha Rahman')).toBeInTheDocument();
    // The name fallback is copy, so it is.
    expect(screen.getByText('ব্যবহারকারী 31')).toBeInTheDocument();
  });
});
