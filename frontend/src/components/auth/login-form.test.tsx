import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, getAccessToken } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { DEMO_ADMIN_EMAIL, DEMO_PASSWORD } from '@/mocks/fixtures';
import { server } from '@/mocks/server';

import { LoginForm } from './login-form';

const replace = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
}));

beforeEach(() => {
  clearTokens();
  replace.mockClear();
  refresh.mockClear();
});

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  renderWithProviders(<LoginForm />);

  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  return user;
}

describe('LoginForm', () => {
  it('renders both fields and the sign-in action', () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a localized message and never calls the API when the email is blank', async () => {
    await submit('', DEMO_PASSWORD);

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks a malformed email before the network round trip', async () => {
    await submit('not-an-email', DEMO_PASSWORD);

    expect(
      await screen.findByText('That does not look like an email address.'),
    ).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });

  it('keeps only the access token and parks the refresh token in a cookie', async () => {
    let adopted: unknown = null;
    server.use(
      http.post('*/api/auth/session', async ({ request }) => {
        adopted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await submit(DEMO_ADMIN_EMAIL, DEMO_PASSWORD);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/home'));
    // The refresh token never lands in JS state: `startSession` hands it to the
    // same-origin route handler, which answers 204 and sets the httpOnly cookie.
    expect(adopted).toEqual({ refresh_token: 'test.refresh.token' });
    expect(getAccessToken()).toBe('test.access.token');
    expect(refresh).toHaveBeenCalled();
  });

  it('maps 401 INVALID_CREDENTIALS to the shared error catalog', async () => {
    await submit(DEMO_ADMIN_EMAIL, 'wrong-password');

    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password/i);
    expect(getAccessToken()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('toggles password visibility without losing the typed value', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    const password = screen.getByLabelText('Password');
    await user.type(password, 'secret');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('secret');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<LoginForm />, { locale: 'bn' });

    expect(screen.getByLabelText('ইমেইল')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'সাইন ইন' })).toBeInTheDocument();
  });
});
