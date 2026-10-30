import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { CONSENT_CHANNELS, type ConsentRecord } from '@/lib/api/users';
import { renderWithProviders } from '@/lib/testing/render';
import { consents } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { ConsentPanel } from './consent-panel';

/**
 * Settings → consent.
 *
 * The bug this screen is shaped to avoid: `GET /users/me/consent` returns ONLY
 * the channels the user has ever acted on, so a panel built from the response
 * would silently hide every channel the user has never touched. These tests pin
 * that the four switches come from `CONSENT_CHANNELS` and that a missing row
 * reads as "off" — not as "not applicable".
 *
 * They also pin the deliberate absence of optimism. A consent row is evidence
 * (the backend stamps IP + user-agent on it), so the switch must not move until
 * the server has answered. That is asserted directly by holding the POST open.
 *
 * The toast is not assertable here: `Toaster` lives in the root layout, which
 * `renderWithProviders` does not mount. Every meaningful outcome in this panel
 * is either a request or an `aria-checked`, and both are.
 */

const CONSENT_PATH = '*/api/v1/users/me/consent';

/**
 * The shared fixture, narrowed to the enum the generated client types.
 *
 * `contracts/types.ts` (what the fixtures are typed against) flattens
 * `ConsentRecord.channel` to `string`, while the OpenAPI client keeps the
 * four-value union. The fixture only holds real enum values, so this cast is the
 * one place that mismatch has to be acknowledged.
 */
const ROWS: ConsentRecord[] = consents.map((row) => ({
  ...row,
  channel: row.channel as ConsentRecord['channel'],
}));

/** A mutable consent list, so a write can be observed the way a server shows it. */
function serveConsens(initial: readonly ConsentRecord[] = ROWS) {
  const state = { rows: [...initial], reads: 0, grants: 0, revokes: [] as string[] };

  server.use(
    http.get(CONSENT_PATH, () => {
      state.reads += 1;
      return HttpResponse.json({ consents: state.rows });
    }),

    http.post(CONSENT_PATH, async ({ request }) => {
      state.grants += 1;
      const body = (await request.json()) as { channel: ConsentRecord['channel'] };
      state.rows = [
        ...state.rows.filter((row) => row.channel !== body.channel),
        {
          channel: body.channel,
          granted: true,
          granted_at: '2026-02-01T09:00:00.000Z',
          revoked_at: null,
        },
      ];
      return HttpResponse.json({ message: 'Consent granted' }, { status: 201 });
    }),

    http.delete('*/api/v1/users/me/consent/:channel', ({ params }) => {
      const channel = String(params.channel);
      state.revokes.push(channel);
      state.rows = state.rows.filter((row) => row.channel !== channel);
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return state;
}

/** The switch for a channel, found by its translated label. */
function switchFor(label: string) {
  return screen.getByRole('switch', { name: label });
}

describe('ConsentPanel', () => {
  it('renders every channel in the contract, not just the ones on the wire', async () => {
    renderWithProviders(<ConsentPanel />);

    // The fixture carries two rows; the enum carries four. All four must appear.
    expect(await screen.findByRole('switch', { name: 'Marketing email' })).toBeInTheDocument();
    expect(switchFor('Marketing SMS')).toBeInTheDocument();
    expect(switchFor('Usage analytics')).toBeInTheDocument();
    expect(switchFor('Product updates')).toBeInTheDocument();

    expect(screen.getAllByRole('switch')).toHaveLength(CONSENT_CHANNELS.length);
  });

  it('reads granted, revoked and absent rows as on, off and off', async () => {
    renderWithProviders(<ConsentPanel />);

    // Granted and never revoked.
    expect(await screen.findByRole('switch', { name: 'Marketing email' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // A row that EXISTS but was revoked — "row present" must not be read as on.
    expect(switchFor('Usage analytics')).toHaveAttribute('aria-checked', 'false');
    // Channels with no row at all are a real "never acted on".
    expect(switchFor('Marketing SMS')).toHaveAttribute('aria-checked', 'false');
    expect(switchFor('Product updates')).toHaveAttribute('aria-checked', 'false');
  });

  it('does not move the switch until the server has recorded the consent', async () => {
    const user = userEvent.setup();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = serveConsens();

    server.use(
      http.post(CONSENT_PATH, async ({ request }) => {
        const body = (await request.json()) as { channel: ConsentRecord['channel'] };
        await gate;
        state.rows = [
          ...state.rows,
          {
            channel: body.channel,
            granted: true,
            granted_at: '2026-02-01T09:00:00.000Z',
            revoked_at: null,
          },
        ];
        return HttpResponse.json({ message: 'Consent granted' }, { status: 201 });
      }),
    );

    renderWithProviders(<ConsentPanel />);

    const toggle = await screen.findByRole('switch', { name: 'Product updates' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);

    // In flight: the switch is held, not optimistically painted green.
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    release();

    // Only once the server's answer invalidates the list does it flip — and it
    // flips from a RE-READ, which is the real record, not from the click.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(state.reads).toBeGreaterThan(1);
  });

  it('grants a channel by name and refreshes the list', async () => {
    const user = userEvent.setup();
    const state = serveConsens();
    renderWithProviders(<ConsentPanel />);

    await user.click(await screen.findByRole('switch', { name: 'Marketing SMS' }));

    await waitFor(() => expect(state.grants).toBe(1));
    // The response carries no row, so the list has to be invalidated rather than
    // patched — a second read is the proof.
    await waitFor(() => expect(state.reads).toBe(2));
    expect(switchFor('Marketing SMS')).toHaveAttribute('aria-checked', 'true');
  });

  it('revokes a granted channel through the path parameter', async () => {
    const user = userEvent.setup();
    const state = serveConsens();
    renderWithProviders(<ConsentPanel />);

    await user.click(await screen.findByRole('switch', { name: 'Marketing email' }));

    await waitFor(() => expect(state.revokes).toEqual(['email_marketing']));
    await waitFor(() =>
      expect(switchFor('Marketing email')).toHaveAttribute('aria-checked', 'false'),
    );
    expect(state.grants).toBe(0);
  });

  it('lets the user retry when the list itself is unavailable', async () => {
    const user = userEvent.setup();
    const state = serveConsens();
    const failure: ApiErrorBody = {
      error: 'RATE_LIMITED',
      status: 429,
      detail: 'too many requests',
      path: '/api/v1/users/me/consent',
      request_id: 'test-request-id',
    };

    server.use(http.get(CONSENT_PATH, () => HttpResponse.json(failure, { status: 429 })));

    renderWithProviders(<ConsentPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your consent choices");
    // No switches to lie with while the record is unknown.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);

    server.use(
      http.get(CONSENT_PATH, () => {
        state.reads += 1;
        return HttpResponse.json({ consents: state.rows });
      }),
    );
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('switch', { name: 'Marketing email' })).toBeInTheDocument();
  });

  it('renders Bangla channel copy under the bn locale', async () => {
    renderWithProviders(<ConsentPanel />, { locale: 'bn' });

    expect(await screen.findByRole('switch', { name: 'মার্কেটিং ইমেইল' })).toBeInTheDocument();
    expect(switchFor('ব্যবহারের অ্যানালিটিক্স')).toBeInTheDocument();
    expect(screen.getByText('মার্কেটিং এসএমএস')).toBeInTheDocument();
  });
});
