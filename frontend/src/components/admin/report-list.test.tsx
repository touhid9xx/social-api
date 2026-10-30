import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { reports } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { ReportList } from './report-list';

/**
 * The moderation queue screen.
 *
 * Four behaviours carry the contract, so four groups of assertions:
 *
 *  - **One `open` row and one `resolved` row are enough to prove both shapes.**
 *    The open row (901) must offer triage and the note field; the resolved row
 *    (902) must show its decision and no buttons, because the backend locks
 *    terminal states (`REPORT_LOCKED`) — dead controls would be a lie.
 *  - **Every write carries the rendered `version`.** That is the optimistic lock;
 *    sending anything else would let one moderator overwrite another.
 *  - **A `409` is not a failure to apologise for.** It means the row moved, so the
 *    screen offers a reload INLINE (a toast would vanish mid-read).
 *  - **A `403` is the expected answer for a signed-in non-moderator** — `ProfileSelf`
 *    exposes no role, so the screen renders and lets the server explain itself.
 *
 * (খোলা রিপোর্টে বোতাম থাকে, বন্ধ রিপোর্টে থাকে না; লেখার সঙ্গে version যায়।)
 */

const LIST_PATH = '*/api/v1/moderation/reports';
const REPORT_PATH = '*/api/v1/moderation/reports/:report_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/** The rendered rows, newest-first, exactly as the fixture orders them. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

describe('ReportList', () => {
  it('renders both queue shapes from the fixtures', async () => {
    renderWithProviders(<ReportList />);

    expect(
      await screen.findByText('Same promotional link pasted under four different posts.'),
    ).toBeInTheDocument();

    // Reporter names come from `useAuthor`, not from the report row.
    expect(await screen.findByText('Reported by Alice Rahman')).toBeInTheDocument();
    expect(await screen.findByText('Reported by Bashir Hossain')).toBeInTheDocument();

    // Target line, badge copy and count all come from the catalog. The badges are
    // scoped to their row because the filter's <option>s repeat the same words.
    expect(screen.getByText('Post #101')).toBeInTheDocument();
    expect(screen.getByText('Comment #501')).toBeInTheDocument();
    const [open, closed] = rows();
    if (!open || !closed) throw new Error('expected exactly two report rows');
    expect(within(open).getByText('Open')).toBeInTheDocument();
    expect(within(closed).getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('2 reports')).toBeInTheDocument();
  });

  it('shows the closed decision instead of the triage controls', async () => {
    renderWithProviders(<ReportList />);

    await screen.findByText('Same promotional link pasted under four different posts.');

    const [open, closed] = rows();
    if (!open || !closed) throw new Error('expected exactly two report rows');

    // Open row 901: all three writable transitions, plus the note field.
    expect(within(open).getByRole('button', { name: 'Start review' })).toBeInTheDocument();
    expect(within(open).getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(within(open).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(within(open).getByPlaceholderText('What did you decide, and why?')).toBeInTheDocument();

    // Resolved row 902: terminal, so it says so and offers nothing to click.
    expect(within(closed).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(closed).getByText('This report is closed. Reopening is not supported.'),
    ).toBeInTheDocument();
    expect(within(closed).getByText('Resolution note')).toBeInTheDocument();
    expect(
      within(closed).getByText('Removed the reply and warned the author.'),
    ).toBeInTheDocument();

    // 902 has `details: null`, which must not render as a blank line.
    expect(within(closed).getByText('No extra details were given.')).toBeInTheDocument();
  });

  it('sends the rendered version and the trimmed note on a transition', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];

    server.use(
      http.patch(REPORT_PATH, async ({ request, params }) => {
        bodies.push(await request.json());
        const report = reports.find((row) => row.id === Number(params.report_id));
        if (!report) return HttpResponse.json({}, { status: 404 });
        return HttpResponse.json({ ...report, status: 'resolved', version: report.version + 1 });
      }),
    );

    renderWithProviders(<ReportList />);

    await screen.findByText('Same promotional link pasted under four different posts.');
    await user.type(
      screen.getByPlaceholderText('What did you decide, and why?'),
      '  Removed the post.  ',
    );
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      version: 1,
      status: 'resolved',
      resolution_note: 'Removed the post.',
    });
  });

  it('sends a null note when the moderator wrote nothing', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];

    server.use(
      http.patch(REPORT_PATH, async ({ request, params }) => {
        bodies.push(await request.json());
        const report = reports.find((row) => row.id === Number(params.report_id));
        if (!report) return HttpResponse.json({}, { status: 404 });
        return HttpResponse.json({ ...report, status: 'dismissed', version: report.version + 1 });
      }),
    );

    renderWithProviders(<ReportList />);

    await screen.findByText('Same promotional link pasted under four different posts.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ version: 1, status: 'dismissed', resolution_note: null });
  });

  it('offers an inline reload when the row moved underneath the moderator', async () => {
    const user = userEvent.setup();
    let listReads = 0;

    server.use(
      http.get(LIST_PATH, () => {
        listReads += 1;
        return HttpResponse.json({ items: reports, next_cursor: null });
      }),
      http.patch(REPORT_PATH, ({ params }) =>
        HttpResponse.json(
          errorBody(
            'VERSION_CONFLICT',
            409,
            `/api/v1/moderation/reports/${String(params.report_id)}`,
          ),
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<ReportList />);

    await screen.findByText('Same promotional link pasted under four different posts.');
    const readsBefore = listReads;

    await user.click(screen.getByRole('button', { name: 'Start review' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Someone else reviewed this while you had it open.');

    // A conflict is not retried by the mutation; the fix is a deliberate reload.
    await user.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(listReads).toBeGreaterThan(readsBefore));
  });

  it('narrows the request when a status filter is chosen', async () => {
    const user = userEvent.setup();
    const statuses: Array<string | null> = [];

    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        statuses.push(status);
        const items =
          status === null ? reports : reports.filter((report) => report.status === status);
        return HttpResponse.json({ items, next_cursor: null });
      }),
    );

    renderWithProviders(<ReportList />);

    await screen.findByText('Same promotional link pasted under four different posts.');

    // The select is built from `REPORT_STATUSES`, so every stored status is here.
    const select = screen.getByLabelText('Status');
    expect(within(select).getAllByRole('option')).toHaveLength(5);

    await user.selectOptions(select, 'resolved');

    // `status` is a server-side filter: closed reports must not be filtered
    // client-side out of an already-open page.
    await waitFor(() => expect(statuses).toContain('resolved'));
    await waitFor(() => expect(screen.queryByText('Post #101')).not.toBeInTheDocument());
    expect(screen.getByText('Comment #501')).toBeInTheDocument();
  });

  it('explains a staff-only queue instead of showing a failure', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/moderation/reports'), {
          status: 403,
        }),
      ),
    );

    renderWithProviders(<ReportList />);

    expect(await screen.findByText('Staff only')).toBeInTheDocument();
    // Not the retryable error panel — a 403 is an answer, not a broken request.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders the Bangla queue under the bn locale', async () => {
    renderWithProviders(<ReportList />, { locale: 'bn' });

    // The catalog is Bangla; the report body is user content and stays as written.
    expect(
      await screen.findByText('Same promotional link pasted under four different posts.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Alice Rahman রিপোর্ট করেছেন')).toBeInTheDocument();
    // `{count}` is locale-formatted by next-intl, so only the unit is asserted.
    expect(screen.getByText(/টি রিপোর্ট/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'সমাধান হিসেবে চিহ্নিত করুন' })).toBeInTheDocument();
    expect(screen.getByLabelText('অবস্থা')).toBeInTheDocument();
  });
});
