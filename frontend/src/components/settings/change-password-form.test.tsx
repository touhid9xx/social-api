import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { DEMO_PASSWORD } from '@/mocks/fixtures';
import { server } from '@/mocks/server';

import { ChangePasswordForm } from './change-password-form';

/**
 * Settings → Security.
 *
 * The two behaviours worth guarding, beyond rendering:
 *   1. A wrong current password is an ANSWER about the password, not an expired
 *      session — it must surface inline and must not be swallowed by the client's
 *      401 refresh path (that path is excluded in `NO_RETRY_PATHS`).
 *   2. Success signs the user out, because the backend blacklists the access
 *      token the request arrived on.
 *
 * (ভুল বর্তমান পাসওয়ার্ড = সেশন এক্সপায়ার নয়; সফল হলে সাইন আউট বাধ্যতামূলক।)
 */

const CHANGE_PATH = '*/api/v1/auth/change-password';
const LOGOUT_PATH = '*/api/auth/logout';

const replace = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

/** The five policy rows, in `PASSWORD_RULES` order. */
function ruleItems() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

function errorBody(error: string, status: number, path: string) {
  return HttpResponse.json(
    { error, status, detail: null, path, request_id: 'test-request' },
    { status },
  );
}

/** Fill both fields and submit. `current` is what proves ownership. */
async function submit(current: string, next: string) {
  const user = userEvent.setup();
  renderWithProviders(<ChangePasswordForm />);

  if (current) await user.type(screen.getByLabelText('Current password'), current);
  if (next) await user.type(screen.getByLabelText('New password'), next);
  await user.click(screen.getByRole('button', { name: 'Change password' }));

  return user;
}

beforeEach(() => {
  clearTokens();
  replace.mockClear();
  refresh.mockClear();
  toastSuccess.mockClear();
  server.use(http.post(LOGOUT_PATH, () => new HttpResponse(null, { status: 204 })));
});

describe('ChangePasswordForm', () => {
  it('renders both password fields, the action and the full policy checklist', () => {
    renderWithProviders(<ChangePasswordForm />);

    expect(screen.getByLabelText('Current password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(ruleItems()).toHaveLength(5);
  });

  it('blocks submission client-side when the new password breaks the policy', async () => {
    let called = false;
    server.use(
      http.post(CHANGE_PATH, () => {
        called = true;
        return HttpResponse.json({ message: 'ok' });
      }),
    );

    await submit(DEMO_PASSWORD, 'alllowercasepassword');

    expect(
      await screen.findByText(
        'Add an uppercase letter, a lowercase letter, a number and a symbol.',
      ),
    ).toBeInTheDocument();
    expect(called).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('requires the current password before hitting the API', async () => {
    let called = false;
    server.use(
      http.post(CHANGE_PATH, () => {
        called = true;
        return HttpResponse.json({ message: 'ok' });
      }),
    );

    await submit('', DEMO_PASSWORD);

    expect(await screen.findByText('Enter your password.')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('sends both passwords, then signs out and returns to login', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(CHANGE_PATH, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ message: 'Password changed' });
      }),
    );

    await submit(DEMO_PASSWORD, 'AnotherPassw0rd!');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(body).toEqual({ current_password: DEMO_PASSWORD, new_password: 'AnotherPassw0rd!' });
    expect(toastSuccess).toHaveBeenCalledWith('Password changed. Please sign in again.');
    // Server-rendered output was produced with the cookie; drop it too.
    expect(refresh).toHaveBeenCalled();
  });

  it('re-words a wrong current password instead of showing the login copy', async () => {
    server.use(
      http.post(CHANGE_PATH, () =>
        errorBody('INVALID_CREDENTIALS', 401, '/api/v1/auth/change-password'),
      ),
    );

    await submit('not-the-password', 'AnotherPassw0rd!');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That current password is not right.',
    );
    // The 401 is an answer, not an expired session: no refresh-and-replay, no sign-out.
    expect(replace).not.toHaveBeenCalled();
    // The form stays usable so the user can correct the field.
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<ChangePasswordForm />, { locale: 'bn' });

    expect(screen.getByLabelText('বর্তমান পাসওয়ার্ড')).toBeInTheDocument();
    expect(screen.getByLabelText('নতুন পাসওয়ার্ড')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পাসওয়ার্ড বদলান' })).toBeInTheDocument();
  });
});
