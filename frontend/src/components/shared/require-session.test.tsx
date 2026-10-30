import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, markBootstrapped, resetBootstrap, setAccessToken } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';

import { RequireSession } from './require-session';

/**
 * The client-side half of the session gate.
 *
 * The bug this suite exists to prevent: redirecting on `accessToken === null`
 * alone. On every reload that is momentarily true while the httpOnly cookie is
 * being exchanged, so a naive guard flashes /login on a perfectly valid
 * session. The guard must wait for `bootstrapped`.
 *
 * (রিলোডে টোকেন ফেরত পাওয়ার আগেই null থাকে — `bootstrapped`-এর আগে
 *  রিডাইরেক্ট করলেই ভ্যালিড সেশন বারবার /login-এ লাফাত।)
 */

const replace = vi.fn();

let pathname = '/home';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
}));

beforeEach(() => {
  clearTokens();
  resetBootstrap();
  replace.mockClear();
  pathname = '/home';
});

describe('RequireSession', () => {
  it('renders the page when a session is in place', () => {
    setAccessToken('test.access.token');
    markBootstrapped();

    renderWithProviders(
      <RequireSession>
        <p>protected content</p>
      </RequireSession>,
    );

    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('waits instead of redirecting while the bootstrap is still running', async () => {
    // The reload window: no token in memory yet, cookie not exchanged yet.
    clearTokens();
    resetBootstrap();

    renderWithProviders(
      <RequireSession>
        <p>protected content</p>
      </RequireSession>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(replace).not.toHaveBeenCalled();
    // Protected markup must never be painted before the decision is made.
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('redirects an expired session to /login, remembering the page', async () => {
    clearTokens();
    markBootstrapped();

    renderWithProviders(
      <RequireSession>
        <p>protected content</p>
      </RequireSession>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fhome'));
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('encodes a nested detail route in the redirect target', async () => {
    pathname = '/posts/42';
    clearTokens();
    markBootstrapped();

    renderWithProviders(
      <RequireSession>
        <p>protected content</p>
      </RequireSession>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fposts%2F42'));
  });

  it('announces the restoring state under the bn locale', () => {
    clearTokens();
    resetBootstrap();

    renderWithProviders(
      <RequireSession>
        <p>protected content</p>
      </RequireSession>,
      { locale: 'bn' },
    );

    expect(screen.getByRole('status')).toHaveTextContent('আপনার সেশন ফিরিয়ে আনা হচ্ছে…');
  });
});
