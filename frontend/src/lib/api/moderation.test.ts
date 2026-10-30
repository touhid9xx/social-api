import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { reports } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { REPORT_STATUSES, REPORT_TRANSITIONS, getReports, updateReport } from './moderation';

/**
 * The staff report queue client.
 *
 * What is pinned here is what the *contract* pins, not what the UI happens to
 * do today:
 *
 *  - the first page sends NO cursor (a `null` would arrive as the literal
 *    string "null") and an opaque cursor round-trips untouched;
 *  - `status` is a real filter on the server, so a filtered page is a different
 *    page — the mock slices the FILTERED list so a test cannot pass by accident;
 *  - every write carries the `version` the moderator was looking at, and a
 *    stale one is a `409 VERSION_CONFLICT` rather than a silent overwrite;
 *  - terminal reports are locked server-side (`REPORT_LOCKED`), which is why the
 *    screen hides the buttons instead of trusting the client.
 *
 * (প্রথম পাতায় cursor যায় না; লেখার আগে version পাঠানো বাধ্যতামূলক।)
 */

const LIST_PATH = '*/api/v1/moderation/reports';
const REPORT_PATH = '*/api/v1/moderation/reports/:report_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

describe('getReports', () => {
  it('returns the queue from the shared fixture', async () => {
    const page = await getReports();

    expect(page.items.map((report) => report.id)).toEqual(reports.map((report) => report.id));
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

    await getReports({ limit: 5 });

    const params = new URLSearchParams(search);
    expect(params.get('limit')).toBe('5');
    // A `cursor=null` would be forwarded as the string "null".
    expect(params.has('cursor')).toBe(false);
    // `status: null` means "every status", which the backend spells as absent.
    expect(params.has('status')).toBe(false);
  });

  it('sends the status filter and pages the filtered list', async () => {
    let status: string | null = null;
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        status = new URL(request.url).searchParams.get('status');
        const rows = reports.filter((report) => report.status === 'resolved');
        // `next_cursor` must point past the FILTERED list, not the whole queue.
        return HttpResponse.json({ items: rows, next_cursor: '1' });
      }),
    );

    const page = await getReports({ status: 'resolved' });

    expect(status).toBe('resolved');
    expect(page.items.every((report) => report.status === 'resolved')).toBe(true);
    expect(page.next_cursor).toBe('1');
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
    await getReports({ cursor: 'eyJvZmZzZXQiOjIwfQ', limit: 2 });

    expect(cursor).toBe('eyJvZmZzZXQiOjIwfQ');
  });

  it('normalises a refusal into an AppApiError', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/moderation/reports'), {
          status: 403,
        }),
      ),
    );

    const error = await getReports().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('FORBIDDEN');
    // The queue is staff-only and `ProfileSelf` exposes no role, so 403 is the
    // expected answer for a signed-in non-moderator — it must not be retried.
    expect(error.isClientError).toBe(true);
  });
});

describe('updateReport', () => {
  it('sends the rendered version and returns the bumped one', async () => {
    let body: unknown = null;
    server.use(
      http.patch(REPORT_PATH, async ({ request, params }) => {
        body = await request.json();
        const report = reports.find((row) => row.id === Number(params.report_id));
        if (!report) return HttpResponse.json({}, { status: 404 });
        return HttpResponse.json({
          ...report,
          status: 'under_review',
          version: report.version + 1,
        });
      }),
    );

    const updated = await updateReport(901, {
      version: 1,
      status: 'under_review',
      resolution_note: '  looking into it  ',
    });

    expect(body).toEqual({
      version: 1,
      status: 'under_review',
      resolution_note: '  looking into it  ',
    });
    expect(updated.status).toBe('under_review');
    expect(updated.version).toBe(2);
  });

  it('closing a report also stamps the reviewer and the resolution', async () => {
    const updated = await updateReport(901, {
      version: 1,
      status: 'resolved',
      resolution_note: 'Removed the post.',
    });

    // Fixture 901 is `open` at version 1, so this is a valid transition.
    expect(updated.status).toBe('resolved');
    expect(updated.version).toBe(2);
    expect(updated.reviewer_id).not.toBeNull();
    expect(updated.resolution_note).toBe('Removed the post.');
    expect(updated.resolved_at).not.toBeNull();
  });

  it('treats a stale version as a conflict, never as a silent overwrite', async () => {
    const error = await updateReport(901, { version: 99, status: 'under_review' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('VERSION_CONFLICT');
    expect(error.status).toBe(409);
    // 409 is a 4xx — the screen offers a reload, and React Query must not retry.
    expect(error.isClientError).toBe(true);
  });

  it('refuses to move a terminal report and says so', async () => {
    // Fixture 902 is `resolved` at version 2; only a repeat of that status is a
    // no-op, anything else is locked.
    const error = await updateReport(902, { version: 2, status: 'dismissed' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('REPORT_LOCKED');
  });

  it('surfaces an unknown report as REPORT_NOT_FOUND', async () => {
    const error = await updateReport(999_999, { version: 1, status: 'resolved' }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.code).toBe('REPORT_NOT_FOUND');
  });

  it('calls the report path, not a collection route', async () => {
    const paths: string[] = [];
    const closed = reports.find((report) => report.id === 902);
    if (!closed) throw new Error('fixture report 902 is missing');

    server.use(
      http.patch(REPORT_PATH, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(closed);
      }),
    );

    await updateReport(902, { version: 2, status: 'resolved' });

    expect(paths).toEqual(['/api/v1/moderation/reports/902']);
  });
});

// The two tuples drive the filter select and the triage buttons, so they have to
// stay in step with the contract: every stored status is filterable, and no
// transition may name a status the PATCH schema rejects.
describe('status tuples', () => {
  it('lists every filterable status in triage order', () => {
    expect([...REPORT_STATUSES]).toEqual(['open', 'under_review', 'resolved', 'dismissed']);
  });

  it('never offers `open` as a transition target', () => {
    expect(REPORT_TRANSITIONS).not.toContain('open');
    for (const status of REPORT_TRANSITIONS) {
      expect(REPORT_STATUSES).toContain(status);
    }
  });
});
