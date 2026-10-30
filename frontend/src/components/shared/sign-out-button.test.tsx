import type * as ReactQuery from '@tanstack/react-query';

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, getAccessToken, resetBootstrap, setAccessToken } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';

import { SignOutButton } from './sign-out-button';

/**
 * The sign-out control.
 *
 * The invariant that matters: signing out is UNCONDITIONAL. The local session
 * must be gone even when the revoke call fails, because a user who asked to
 * sign out must never be left signed in by an unreachable API.
 *
 * (ব্যাকএন্ড ডাউন থাকলেও লোকাল সেশন অবশ্যই মুছবে — সেটাই এখানে পাহারা দেওয়া হয়।)
 */

const replace = vi.fn();
const refresh = vi.fn();
const clear = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
}));

// The app shares one QueryClient, created by `QueryProvider`. Spying on
// `useQueryClient` is the only way to observe the cache being dropped without
// reaching into the provider's internals.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return { ...actual, useQueryClient: () => ({ clear }) };
});

beforeEach(() => {
  clearTokens();
  resetBootstrap();
  replace.mockClear();
  refresh.mockClear();
  clear.mockClear();
});

describe('SignOutButton', () => {
  it('renders a labelled sign-out control', () => {
    renderWithProviders(<SignOutButton />);

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('ends the session, drops the cache and returns to login', async () => {
    let forwarded: string | null = null;
    server.use(
      http.post('*/api/auth/logout', ({ request }) => {
        forwarded = request.headers.get('authorization');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setAccessToken('test.access.token');

    const user = userEvent.setup();
    renderWithProviders(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(getAccessToken()).toBeNull();
    expect(clear).toHaveBeenCalled();
    // The access token is forwarded so the backend can blacklist its JTI.
    expect(forwarded).toBe('Bearer test.access.token');
    // Server-rendered output was produced with the cookie; drop it too.
    expect(refresh).toHaveBeenCalled();
  });

  it('still signs out locally when the revoke call fails', async () => {
    server.use(http.post('*/api/auth/logout', () => HttpResponse.error()));
    setAccessToken('test.access.token');

    const user = userEvent.setup();
    renderWithProviders(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(getAccessToken()).toBeNull();
    expect(clear).toHaveBeenCalled();
  });

  it('disables the control while the sign-out is in flight', async () => {
    let release: () => void = () => {};
    server.use(
      http.post(
        '*/api/auth/logout',
        async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return new HttpResponse(null, { status: 204 });
        },
        { once: true },
      ),
    );
    setAccessToken('test.access.token');

    const user = userEvent.setup();
    renderWithProviders(<SignOutButton />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    const busy = await screen.findByRole('button', { name: 'Signing out…' });
    expect(busy).toBeDisabled();

    await act(async () => {
      release();
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('renders the Bangla label under the bn locale', () => {
    renderWithProviders(<SignOutButton />, { locale: 'bn' });

    expect(screen.getByRole('button', { name: 'সাইন আউট' })).toBeInTheDocument();
  });
});
