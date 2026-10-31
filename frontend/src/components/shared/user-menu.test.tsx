import type * as ReactQuery from '@tanstack/react-query';

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, getAccessToken, resetBootstrap, setAccessToken } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { adminProfile, adminUser } from '@/mocks/fixtures';
import { server } from '@/mocks/server';

import { UserMenu } from './user-menu';

/**
 * The account dropdown in the shell's top-right corner.
 *
 * What is pinned here, beyond "it renders":
 *
 *  - the trigger's accessible name is FIXED ("Account menu"). If it were the
 *    display name it would change mid-render as the profile loads, which is noise
 *    to a screen reader and an unstable query target for every other test;
 *  - the profile/gallery entries only exist once `GET /users/me` has answered.
 *    `/profile` with no id is not a page, and a guessed href is a 404 on exactly
 *    the two controls that answer "where is my stuff";
 *  - the same menu is what a signed-OUT visitor sees in the shell (it renders
 *    outside `RequireSession`), so it must not fire a guaranteed 401;
 *  - the theme picker is icon-only buttons, one per mode, not a cycling word.
 *
 * (প্রোফাইল-সংক্রান্ত অপশন শুধু এই মেনুতেই; টোকেন ছাড়া `/users/me` ডাকা হয় না।)
 */

const ME_PATH = '/api/v1/users/me';

/**
 * The only payload that carries a role. `/users/me` answers `ProfileSelf`, which
 * has no `role` field, so the staff entry cannot be driven by that read.
 */
const AUTH_ME_PATH = '/api/v1/auth/me';

const replace = vi.fn();
const refresh = vi.fn();
const clear = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn() }),
}));

// Sign-out clears the shared QueryClient; spying on `useQueryClient` is the only
// way to observe that without reaching into the provider's internals.
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

function trigger() {
  return screen.getByRole('button', { name: 'Account menu' });
}

/** Opens the menu and returns the menu surface. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return screen.findByRole('menu');
}

describe('UserMenu', () => {
  it('renders an avatar trigger with a fixed accessible name and no visible text', () => {
    renderWithProviders(<UserMenu />);

    // No token and no profile yet: the fallback initial, never a word.
    expect(trigger()).toHaveTextContent('?');
    expect(trigger()).toHaveAccessibleName('Account menu');
  });

  it('does not read the profile without an access token', async () => {
    const requested: string[] = [];
    server.use(
      http.get(`*${ME_PATH}`, () => {
        requested.push(ME_PATH);
        return HttpResponse.json(adminProfile);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    const menu = await open(user);

    // Give the query a turn to run; it must stay gated off.
    await Promise.resolve();
    expect(requested).toEqual([]);

    // Signed-out copy, and no dead links to "your" profile or gallery.
    expect(within(menu).getByText('Not signed in')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Your profile' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Your gallery' })).toBeNull();
    // Settings is not person-specific, so it stays reachable.
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('links to the profile, gallery and settings once the profile loads', async () => {
    setAccessToken('test.access.token');

    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    const menu = await open(user);

    // The display name is the menu heading; the subline is the static "Signed in".
    expect(await within(menu).findByText('Admin')).toBeInTheDocument();
    expect(within(menu).getByText('Signed in')).toBeInTheDocument();

    expect(within(menu).getByRole('menuitem', { name: 'Your profile' })).toHaveAttribute(
      'href',
      `/profile/${adminProfile.user_id}`,
    );
    expect(within(menu).getByRole('menuitem', { name: 'Your gallery' })).toHaveAttribute(
      'href',
      `/profile/${adminProfile.user_id}/gallery`,
    );
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('falls back to a neutral label when the profile has no display name', async () => {
    setAccessToken('test.access.token');
    server.use(
      http.get(`*${ME_PATH}`, () => HttpResponse.json({ ...adminProfile, display_name: null })),
    );

    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    const menu = await open(user);

    expect(await within(menu).findByText('Your account')).toBeInTheDocument();
    // The account is real, so the links are still there.
    expect(within(menu).getByRole('menuitem', { name: 'Your profile' })).toBeInTheDocument();
  });

  it('offers the theme as one icon button per mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    const menu = await open(user);

    const group = within(menu).getByRole('group', { name: 'Theme' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Theme: Light',
      'Theme: Dark',
      'Theme: System',
    ]);
    // Icon-only: the mode is a name, never visible text.
    for (const button of buttons) {
      expect(button).toHaveTextContent('');
    }
  });

  it('signs out from the menu and returns to login', async () => {
    setAccessToken('test.access.token');

    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    const menu = await open(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(getAccessToken()).toBeNull();
    expect(clear).toHaveBeenCalled();
  });

  /**
   * The staff entry. Three things matter: it exists at all (the console was
   * previously reachable only by typing the URL), it points somewhere the
   * account can actually open, and it stays hidden from everyone else.
   */
  describe('staff console entry', () => {
    it('links an admin to the console root', async () => {
      setAccessToken('test.access.token');

      const user = userEvent.setup();
      renderWithProviders(<UserMenu />);

      const menu = await open(user);

      expect(await within(menu).findByRole('menuitem', { name: 'Admin console' })).toHaveAttribute(
        'href',
        '/admin',
      );
    });

    it('sends a moderator to the report queue, never the admin-only root', async () => {
      setAccessToken('test.access.token');
      server.use(
        http.get(`*${AUTH_ME_PATH}`, () => HttpResponse.json({ ...adminUser, role: 'moderator' })),
      );

      const user = userEvent.setup();
      renderWithProviders(<UserMenu />);

      const menu = await open(user);

      expect(
        await within(menu).findByRole('menuitem', { name: 'Moderation queue' }),
      ).toHaveAttribute('href', '/admin/reports');
      // `/admin` (flags) and `/admin/audit` are `require_roles(UserRole.ADMIN)`,
      // so pointing a moderator at the console root would be a guaranteed 403.
      expect(within(menu).queryByRole('menuitem', { name: 'Admin console' })).toBeNull();
    });

    it('shows no staff entry to a plain user', async () => {
      setAccessToken('test.access.token');
      const asked: string[] = [];
      server.use(
        http.get(`*${AUTH_ME_PATH}`, () => {
          asked.push(AUTH_ME_PATH);
          return HttpResponse.json({ ...adminUser, role: 'user' });
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<UserMenu />);

      const menu = await open(user);

      // Wait for the role read to actually answer, so "no entry" means "this
      // role has none", not "the query has not landed yet".
      await waitFor(() => expect(asked).toEqual([AUTH_ME_PATH]));
      expect(within(menu).queryByRole('menuitem', { name: 'Admin console' })).toBeNull();
      expect(within(menu).queryByRole('menuitem', { name: 'Moderation queue' })).toBeNull();
    });

    it('does not ask for the role without an access token', async () => {
      const asked: string[] = [];
      server.use(
        http.get(`*${AUTH_ME_PATH}`, () => {
          asked.push(AUTH_ME_PATH);
          return HttpResponse.json(adminUser);
        }),
      );

      const user = userEvent.setup();
      renderWithProviders(<UserMenu />);

      const menu = await open(user);

      await Promise.resolve();
      expect(asked).toEqual([]);
      expect(within(menu).queryByRole('menuitem', { name: 'Admin console' })).toBeNull();
    });
  });

  it('labels the menu in Bangla under the bn locale', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />, { locale: 'bn' });

    await user.click(screen.getByRole('button', { name: 'অ্যাকাউন্ট মেনু' }));
    const menu = await screen.findByRole('menu');

    expect(within(menu).getByText('সাইন ইন করা নেই')).toBeInTheDocument();
    expect(within(menu).getByRole('group', { name: 'থিম' })).toBeInTheDocument();
  });
});
