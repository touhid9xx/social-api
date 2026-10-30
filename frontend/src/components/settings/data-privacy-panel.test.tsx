import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeletionStatus } from '@/lib/api/gdpr';
import { renderWithProviders } from '@/lib/testing/render';
import { deletionStatusNone, deletionStatusScheduled, exportedData } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { DataPrivacyPanel } from './data-privacy-panel';

/**
 * Settings → data & privacy.
 *
 * Two features that look similar and are not: the export is a rate-limited
 * download (one a minute, so the button must disable while in flight) while the
 * deletion is a two-step confirmation whose state lives on the server, not in
 * this tab. Both halves are pinned here.
 *
 * The download is asserted through `URL.createObjectURL` + the anchor's
 * `download` name, because the backend's `Content-Disposition` is dropped by the
 * client — if this panel ever stopped naming the file, nothing else would notice.
 *
 * The status read is `GET /gdpr/deletion-status`, deliberately separate from
 * `DELETE /users/me`: the panel has to render the grace window for an account
 * that was scheduled on another device.
 */

const STATUS_PATH = '*/api/v1/gdpr/deletion-status';
const CANCEL_PATH = '*/api/v1/gdpr/cancel-delete';
const EXPORT_PATH = '*/api/v1/gdpr/export';
const DELETE_ME_PATH = '*/api/v1/users/me';

/** Mutable deletion state, so a cancel can move the panel the way a server would. */
function serveStatus(initial: DeletionStatus = deletionStatusNone) {
  const state = { status: initial, reads: 0 };

  server.use(
    http.get(STATUS_PATH, () => {
      state.reads += 1;
      return HttpResponse.json(state.status);
    }),
  );

  return state;
}

/** jsdom implements no object URLs; capture what the panel hands the browser. */
function captureDownload() {
  const seen: { blob?: Blob; href?: string; filename?: string; revoked?: string } = {};

  URL.createObjectURL = vi.fn((blob: Blob) => {
    seen.blob = blob;
    return 'blob:mock-archive';
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    seen.revoked = url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    seen.href = this.href;
    seen.filename = this.download;
  });

  return seen;
}

beforeEach(() => {
  // Assigned, not spied: jsdom does not define these at all.
  URL.createObjectURL = () => 'blob:unset';
  URL.revokeObjectURL = () => undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DataPrivacyPanel', () => {
  it('offers the delete flow for an account with nothing scheduled', async () => {
    renderWithProviders(<DataPrivacyPanel />);

    expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel deletion' })).not.toBeInTheDocument();
  });

  it('downloads the export under a filename it supplies itself', async () => {
    const user = userEvent.setup();
    const seen = captureDownload();
    renderWithProviders(<DataPrivacyPanel />);

    await user.click(await screen.findByRole('button', { name: 'Download my data' }));

    await waitFor(() => expect(seen.filename).toBe('my-data.json'));
    expect(seen.href).toBe('blob:mock-archive');
    // The bytes came from the endpoint, not from an empty placeholder.
    expect(seen.blob?.type).toBe('application/json');
    expect(JSON.parse((await seen.blob?.text()) ?? 'null')).toEqual(exportedData);
    // Leaking the object URL would keep the archive in memory for the session.
    expect(seen.revoked).toBe('blob:mock-archive');
  });

  it('refuses a second export while the first is still in flight', async () => {
    const user = userEvent.setup();
    // Only the in-flight state matters here, so the download itself is stubbed
    // but not inspected.
    captureDownload();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = { count: 0 };

    server.use(
      http.get(EXPORT_PATH, async () => {
        calls.count += 1;
        await gate;
        return HttpResponse.json(exportedData);
      }),
    );

    renderWithProviders(<DataPrivacyPanel />);

    await user.click(await screen.findByRole('button', { name: 'Download my data' }));
    // 1/minute on the server, so the control must hold while it runs.
    expect(await screen.findByRole('button', { name: 'Preparing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();

    release();
    expect(await screen.findByRole('button', { name: 'Download my data' })).toBeEnabled();
    expect(calls.count).toBe(1);
  });

  it('surfaces the server message when the export is rate-limited', async () => {
    const user = userEvent.setup();
    captureDownload();
    const failure: ApiErrorBody = {
      error: 'RATE_LIMITED',
      status: 429,
      detail: 'only one export a minute',
      path: '/api/v1/gdpr/export',
      request_id: 'test-request-id',
    };
    server.use(http.get(EXPORT_PATH, () => HttpResponse.json(failure, { status: 429 })));

    renderWithProviders(<DataPrivacyPanel />);

    await user.click(await screen.findByRole('button', { name: 'Download my data' }));

    // 429 -> the shared transient-error copy, never the raw code.
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  });

  it('keeps the destructive action behind a confirmation dialog', async () => {
    const user = userEvent.setup();
    const state = serveStatus();
    const deletes = { count: 0 };
    server.use(
      http.delete(DELETE_ME_PATH, () => {
        deletes.count += 1;
        return HttpResponse.json({
          message: 'Account scheduled for deletion',
          hard_delete_after: deletionStatusScheduled.scheduled_hard_delete_at,
        });
      }),
    );

    renderWithProviders(<DataPrivacyPanel />);

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));

    // Opening the dialog must not delete anything on its own.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete your account?')).toBeInTheDocument();
    expect(deletes.count).toBe(0);

    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(deletes.count).toBe(1));
    // The panel switches on the DELETE response alone: a follow-up status read
    // right after the soft-delete is the request most likely to 401.
    expect(await screen.findByRole('button', { name: 'Cancel deletion' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
    expect(state.reads).toBe(1);
  });

  it('leaves the account alone when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    serveStatus();
    const deletes = { count: 0 };
    server.use(
      http.delete(DELETE_ME_PATH, () => {
        deletes.count += 1;
        return HttpResponse.json({ message: 'deleted', hard_delete_after: null });
      }),
    );

    renderWithProviders(<DataPrivacyPanel />);

    await user.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deletes.count).toBe(0);
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

  it('shows the deadline and can cancel a deletion scheduled elsewhere', async () => {
    const user = userEvent.setup();
    const state = serveStatus(deletionStatusScheduled);
    server.use(
      http.post(CANCEL_PATH, () => {
        state.status = deletionStatusNone;
        return HttpResponse.json({ message: 'Deletion cancelled' });
      }),
    );

    renderWithProviders(<DataPrivacyPanel />);

    // The grace window is server state, so a scheduled account opens on it.
    const scheduled = await screen.findByText(/scheduled for permanent deletion on/);
    expect(scheduled).toHaveTextContent('2026');

    await user.click(screen.getByRole('button', { name: 'Cancel deletion' }));

    // Cancelling is the one write whose new state cannot be derived from its
    // response, so the panel must re-read the status instead of assuming "none".
    expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
    expect(state.reads).toBe(2);
  });

  it('lets the user retry when the deletion status cannot be read', async () => {
    const user = userEvent.setup();
    // 4xx on purpose: the shared retry policy retries 5xx twice with backoff,
    // which would make this test wait on TanStack's timers instead of the panel.
    const failure: ApiErrorBody = {
      error: 'RATE_LIMITED',
      status: 429,
      detail: 'slow down',
      path: '/api/v1/gdpr/deletion-status',
      request_id: 'test-request-id',
    };
    const state = serveStatus();
    server.use(http.get(STATUS_PATH, () => HttpResponse.json(failure, { status: 429 })));

    renderWithProviders(<DataPrivacyPanel />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't check your account status");

    server.use(
      http.get(STATUS_PATH, () => {
        state.reads += 1;
        return HttpResponse.json(state.status);
      }),
    );
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderWithProviders(<DataPrivacyPanel />, { locale: 'bn' });

    expect(
      await screen.findByRole('button', { name: 'আমার ডেটা ডাউনলোড করুন' }),
    ).toBeInTheDocument();
    // The deletion half renders after its own status read, so it needs its own await.
    expect(
      await screen.findByRole('button', { name: 'আমার অ্যাকাউন্ট মুছুন' }),
    ).toBeInTheDocument();
  });
});
