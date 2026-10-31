import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { featureFlags } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { FlagList } from './flag-list';

/**
 * The admin feature-flag console.
 *
 * The screen exists to show two things and to write one, so the assertions are
 * grouped the same way:
 *
 *  - **Six rows, exactly one drifting.** `FlagView` carries only `env_value` and
 *    `builtin_value`, so the table's whole job is to put them side by side and
 *    call out the disagreement. The fixture drifts on one flag only, which makes
 *    "drift is per-row, not global" a real assertion instead of a tautology.
 *  - **The write reports the ECHO, not a refresh.** The contract cannot show the
 *    override (no count field, no per-user read), so the only evidence the server
 *    applied it is `FlagOverrideResponse`. Clearing (`enabled: null`) and setting
 *    to `false` both come back as `enabled: false`, so `action` is what the copy
 *    keys off — a test that only checked `enabled` would pass while showing the
 *    wrong sentence.
 *  - **`403` is an answer.** `ProfileSelf` exposes no `role`, so the client cannot
 *    pre-check; the screen renders and lets the server explain itself. There is no
 *    retry, because `query-provider.tsx` skips 4xx.
 *
 * (একটি ফ্ল্যাগেই ডিফট দেখায়; ওভাররাইড লেখার পরে সার্ভারের echo-ই দেখানো হয়।)
 */

const LIST_PATH = '*/api/v1/flags';
const OVERRIDE_PATH = '*/api/v1/flags/:flag_name/override';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/** The rendered flag rows, in fixture order. The override form is not a listitem. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

/**
 * Resolve the console: wait for the skeleton to be replaced by the table.
 *
 * Anchored on the `<ul>` rather than a flag name, because every name also appears
 * as an `<option>` in the override select — a bare `findByText('ws_enabled')`
 * matches twice and throws.
 */
async function ready(): Promise<void> {
  await screen.findByRole('list');
}

describe('FlagList', () => {
  it('lists every flag with its environment value and code default', async () => {
    renderWithProviders(<FlagList />);

    await ready();

    expect(rows()).toHaveLength(6);
    expect(screen.getByText('6 flags')).toBeInTheDocument();

    // Every flag name is rendered as code, exactly as the API spells it. Scoped to
    // the list because the override select repeats each name as an `<option>`.
    const list = screen.getByRole('list');
    for (const { name } of featureFlags.flags) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }

    const rendered = rows();
    const first = rendered[0];
    const last = rendered[rendered.length - 1];
    if (!first || !last) throw new Error('expected six flag rows');

    // 1 and 2 are both true: two "On" badges, and the env value is first.
    expect(within(first).getByText('Environment: On')).toBeInTheDocument();
    expect(within(first).getByText('Code default: On')).toBeInTheDocument();

    // `sms_enabled` is false in both places, so the badges read "Off".
    expect(within(last).getByText('Environment: Off')).toBeInTheDocument();
    expect(within(last).getByText('Code default: Off')).toBeInTheDocument();
  });

  it('shows the drift note on the one row whose values disagree', async () => {
    renderWithProviders(<FlagList />);

    await ready();

    const drift = screen.getAllByText('Differs from the code default');
    expect(drift).toHaveLength(1);

    const rendered = rows();
    const drifted = rendered[3];
    if (!drifted) throw new Error('expected a fourth flag row');

    // `feed_fanout_enabled` is on in the environment and off in the code, which is
    // the only pairing the table calls out.
    expect(within(drifted).getByText('feed_fanout_enabled')).toBeInTheDocument();
    expect(within(drifted).getByText('Environment: On')).toBeInTheDocument();
    expect(within(drifted).getByText('Code default: Off')).toBeInTheDocument();
    expect(within(drifted).getByText('Differs from the code default')).toBeInTheDocument();

    // ...and the two rows around it are quiet, so the note is not just "always on".
    const neighbour = rendered[0];
    if (!neighbour) throw new Error('expected a first flag row');
    expect(within(neighbour).queryByText('Differs from the code default')).not.toBeInTheDocument();
  });

  it('treats 403 as "admins only" rather than an error to apologise for', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/flags'), { status: 403 }),
      ),
    );

    renderWithProviders(<FlagList />);

    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Feature flags are limited to administrators. If you think you should have access, ask an administrator.',
      ),
    ).toBeInTheDocument();

    // The 403 branch is not the generic failure branch: no retry control, and no
    // override form that would only 403 again.
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply override' })).not.toBeInTheDocument();
  });

  it('renders the empty state when the API registers no flags', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ flags: [] })));

    renderWithProviders(<FlagList />);

    expect(await screen.findByText('No flags registered')).toBeInTheDocument();
    // An empty list would leave the override select with nothing to submit, so the
    // form must not be rendered at all.
    expect(screen.queryByRole('button', { name: 'Apply override' })).not.toBeInTheDocument();
  });

  it('posts the override and reports the echoed action, without refetching the list', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const idempotencyKeys: Array<string | null> = [];
    let listReads = 0;

    server.use(
      http.get(LIST_PATH, () => {
        listReads += 1;
        return HttpResponse.json(featureFlags);
      }),
      http.post(OVERRIDE_PATH, async ({ request }) => {
        bodies.push(await request.json());
        idempotencyKeys.push(request.headers.get('idempotency-key'));
        return HttpResponse.json({
          flag: 'ws_enabled',
          user_id: 21,
          enabled: true,
          action: 'set',
        });
      }),
    );

    renderWithProviders(<FlagList />);

    await ready();
    expect(listReads).toBe(1);

    // The select is derived, so it already shows the first flag before any click.
    expect(screen.getByLabelText('Flag')).toHaveValue('ws_enabled');
    await user.type(screen.getByLabelText('User ID'), '21');
    await user.click(screen.getByRole('button', { name: 'Apply override' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ user_id: 21, enabled: true });

    // State-set semantics: this route is not in the idempotency middleware's
    // patterns, so it must not carry a key.
    expect(idempotencyKeys[0]).toBeNull();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'ws_enabled is now on for user 21.',
    );

    // A write cannot change `GET /flags` (no override data in `FlagView`), so the
    // list must not be re-read.
    expect(listReads).toBe(1);
  });

  it('sends enabled: false for "Turn off" and reports that exact sentence', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];

    server.use(
      http.post(OVERRIDE_PATH, async ({ request, params }) => {
        const body = (await request.json()) as { user_id: number; enabled: boolean | null };
        bodies.push(body);
        return HttpResponse.json({
          flag: String(params.flag_name),
          user_id: body.user_id,
          enabled: body.enabled,
          action: 'set',
        });
      }),
    );

    renderWithProviders(<FlagList />);

    await ready();
    await user.selectOptions(screen.getByLabelText('Flag'), 'chat_enabled');
    await user.selectOptions(screen.getByLabelText('Override'), 'off');
    await user.type(screen.getByLabelText('User ID'), '21');
    await user.click(screen.getByRole('button', { name: 'Apply override' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ user_id: 21, enabled: false });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'chat_enabled is now off for user 21.',
    );
  });

  it('sends enabled: null to clear, and says it cleared instead of "off"', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];

    server.use(
      http.post(OVERRIDE_PATH, async ({ request, params }) => {
        const body = (await request.json()) as { user_id: number; enabled: boolean | null };
        bodies.push(body);
        return HttpResponse.json({
          flag: String(params.flag_name),
          user_id: body.user_id,
          enabled: body.enabled,
          action: body.enabled === null ? 'cleared' : 'set',
        });
      }),
    );

    renderWithProviders(<FlagList />);

    await ready();
    await user.selectOptions(screen.getByLabelText('Override'), 'clear');
    await user.type(screen.getByLabelText('User ID'), '21');
    await user.click(screen.getByRole('button', { name: 'Apply override' }));

    await waitFor(() => expect(bodies).toHaveLength(1));

    // `null` is not "missing": it is the contract's clear instruction.
    expect(bodies[0]).toEqual({ user_id: 21, enabled: null });

    // Both this and "off" return `enabled: false` on the wire; only `action`
    // separates them. The wrong sentence here would be invisible to a looser test.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'ws_enabled went back to its environment default for user 21.',
    );
  });

  it('blocks a bad user id before the request leaves', async () => {
    const user = userEvent.setup();
    let posts = 0;

    server.use(
      http.post(OVERRIDE_PATH, () => {
        posts += 1;
        return HttpResponse.json({ flag: 'ws_enabled', user_id: 0, enabled: true, action: 'set' });
      }),
    );

    renderWithProviders(<FlagList />);

    await ready();

    // Blank: nothing has been typed yet.
    await user.click(screen.getByRole('button', { name: 'Apply override' }));
    expect(await screen.findByText('Enter a positive user ID.')).toBeInTheDocument();

    // `0` passes the digits-only check but fails the "positive" one, so it is a
    // separate guard from an empty field.
    await user.type(screen.getByLabelText('User ID'), '0');
    await user.click(screen.getByRole('button', { name: 'Apply override' }));

    expect(await screen.findByText('Enter a positive user ID.')).toBeInTheDocument();
    expect(posts).toBe(0);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('surfaces the server’s rejection through the shared error catalog', async () => {
    const user = userEvent.setup();

    // The select is built from `GET /flags`, so an unknown flag is unreachable
    // from the UI — but it is a real 400 answer (`flags.py:80-86`), and this pins
    // that the screen shows catalog copy rather than a raw code or a crash.
    server.use(
      http.post(OVERRIDE_PATH, () =>
        HttpResponse.json(errorBody('BAD_REQUEST', 400, '/api/v1/flags/ws_enabled/override'), {
          status: 400,
        }),
      ),
    );

    renderWithProviders(<FlagList />);

    await ready();
    await user.type(screen.getByLabelText('User ID'), '21');
    await user.click(screen.getByRole('button', { name: 'Apply override' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That request was not valid.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders under the Bangla catalog', async () => {
    renderWithProviders(<FlagList />, { locale: 'bn' });

    await ready();

    expect(screen.getByText('এনভায়রনমেন্ট: চালু')).toBeInTheDocument();
    expect(screen.getByText('কোডের ডিফল্টের সঙ্গে মিলছে না')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ওভাররাইড প্রয়োগ করুন' })).toBeInTheDocument();

    // Flag names are identifiers, not copy: they stay untranslated in both locales.
    const list = screen.getByRole('list');
    expect(within(list).getByText('feed_fanout_enabled')).toBeInTheDocument();
  });
});
