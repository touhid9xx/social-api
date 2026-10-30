import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, setAccessToken } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';

import { AppNav } from './app-nav';

/**
 * The primary navigation.
 *
 * Two things here are accessibility contracts, not styling choices:
 *
 *  - the current screen is `aria-current="page"`, because a background colour is
 *    invisible to a screen reader;
 *  - the unread count lives in the link's `aria-label`, and the numeral itself is
 *    `aria-hidden` — "3" read between "Notifications" and "link" is noise unless
 *    you already know what it counts.
 *
 * The third is a correctness gate: the nav renders in the shell, OUTSIDE
 * `RequireSession`, so on the landing and sign-in pages there is no token and
 * the badge query must not fire a guaranteed 401.
 *
 * (বর্তমান পাতা `aria-current` দিয়ে ঘোষণা হয়; টোকেন ছাড়া ব্যাজ কোয়েরি চলে না।)
 */

const UNREAD_PATH = '/api/v1/notifications/unread-count';

const state = vi.hoisted(() => ({ pathname: '/home' }));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));

beforeEach(() => {
  clearTokens();
  state.pathname = '/home';
});

describe('AppNav', () => {
  it('renders the three routes that exist', () => {
    renderWithProviders(<AppNav />);

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore');
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'href',
      '/notifications',
    );

    // Milestones that have not shipped must not appear: a nav item leading to
    // "arrives later" is the one control a user is guaranteed to press.
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('marks only the current route as the current page', () => {
    state.pathname = '/explore';

    renderWithProviders(<AppNav />);

    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Notifications' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing current on a route the nav does not own', () => {
    // `/posts/101` is not `/home`, so the exact/prefix rule leaves the nav
    // unhighlighted rather than pretending the user is on the feed.
    state.pathname = '/posts/101';

    renderWithProviders(<AppNav />);

    for (const label of ['Home', 'Explore', 'Notifications']) {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current');
    }
  });

  it('puts the unread count in the notifications link label, not in the reading order', async () => {
    setAccessToken('test-access-token');

    renderWithProviders(<AppNav />);

    const link = await screen.findByRole('link', { name: 'Notifications (3 unread)' });
    expect(link).toHaveAttribute('href', '/notifications');

    // The numeral is decoration: the meaning is already in the link's name.
    const badge = screen.getByText('3');
    expect(badge).toHaveAttribute('aria-hidden', 'true');

    // Other links are untouched by the badge.
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('does not ask for the badge without an access token', async () => {
    const requested: string[] = [];
    server.use(
      http.get(`*${UNREAD_PATH}`, () => {
        requested.push(UNREAD_PATH);
        return HttpResponse.json({ unread: 3 });
      }),
    );

    renderWithProviders(<AppNav />);

    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
    // Give the query a turn to run; it must stay gated off.
    await Promise.resolve();
    expect(requested).toEqual([]);
    expect(screen.queryByText('3')).toBeNull();
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<AppNav />, { locale: 'bn' });

    expect(screen.getByRole('navigation', { name: 'প্রধান নেভিগেশন' })).toBeInTheDocument();
    expect(screen.getByText('হোম')).toBeInTheDocument();
    expect(screen.getByText('এক্সপ্লোর')).toBeInTheDocument();
    expect(screen.getByText('নোটিফিকেশন')).toBeInTheDocument();
  });
});
