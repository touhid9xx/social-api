import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The three writes announce themselves through a toast, and the refusal copy is
// the only place `CANNOT_MODIFY_SELF` / `LAST_ADMIN_PROTECTED` become visible, so
// the announcements are spied on rather than rendered.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { renderWithProviders } from '@/lib/testing/render';
import { adminDirectory } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { UserList } from './user-list';

/**
 * The staff-only user directory — `GET /api/v1/users`.
 *
 * The screen answers three questions, so the assertions are grouped that way:
 *
 *  - **Who is here, and what are they?** The fixture holds one row per role
 *    (admin, moderator, user) plus an unverified/deactivated account with no
 *    `display_name`. A component that hardcoded "Admin", or that rendered a blank
 *    name instead of falling back to `User {id}`, would pass a looser test.
 *  - **One request, not one per row.** `AdminUserView` already carries
 *    `display_name` and `avatar_url`, so resolving an author through
 *    `/users/{id}` would be a request per row for data already in hand. The
 *    profile endpoint is wired to a counting handler and asserted to stay at 0.
 *  - **`403` is an answer, not a failure.** The client cannot pre-check the
 *    caller's role, so the screen renders and lets the server explain itself —
 *    with no retry, because `query-provider.tsx` skips 4xx.
 *
 * `next_cursor` covers a failure the page-level error branch cannot: a *next
 * page* that fails flips `isError` too, and the already-loaded accounts must
 * survive it.
 *
 * The row actions are pinned on the WIRE, not on the pixels: which endpoint was
 * called and with which body. That is the part a refactor can silently break —
 * `{ is_active: true }` instead of `POST /activate` looks identical on screen but
 * leaves `is_verified` false, so the account that was "activated" still cannot
 * sign in to a verified-only screen. Your own row is asserted to carry no menu at
 * all, and both server refusals are asserted to reach the user as their own copy.
 *
 * (প্রতি সারিতে আলাদা অনুরোধ নয়; 403 মানে "শুধু অ্যাডমিন", ব্যর্থতা নয়।
 * অ্যাক্টিভেট আলাদা এন্ডপয়েন্ট — `is_active` আর `is_verified` একসাথে সেট হয়।)
 */

const LIST_PATH = '*/api/v1/users';

/**
 * A profile read for a *directory row*, not for the signed-in user.
 *
 * The screen legitimately reads `GET /users/me` once (to know which row is you and
 * so carry no action menu), and `:user_id` would happily match `me`. Counting only
 * numeric ids keeps the fan-out assertion about what it is actually about.
 */
const ROW_PROFILE_PATH = /\/api\/v1\/users\/\d+$/;

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/** The rendered account rows, in fixture order. Nothing else on this screen is a listitem. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

/** Resolve the directory: wait for the skeleton to be replaced by the list. */
async function ready(): Promise<void> {
  await screen.findByRole('list');
}

type User = ReturnType<typeof userEvent.setup>;

/**
 * Open one row's action menu and return the menu surface.
 *
 * `adminProfile.user_id` (21) is the fixture's first row, so that row is "you" and
 * deliberately has no menu — every action test targets a row that is not self.
 */
async function openMenu(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
}

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('UserList', () => {
  it('lists every account with its own role, state and joined date', async () => {
    renderWithProviders(<UserList />);

    await ready();

    expect(rows()).toHaveLength(3);
    expect(screen.getByText('3 accounts')).toBeInTheDocument();

    const rendered = rows();
    const [admin, moderator, plain] = rendered;
    if (!admin || !moderator || !plain) throw new Error('expected three account rows');

    // Three roles, three different badges: the whole point of the screen is that
    // `role` differs per row, so an all-admin fixture would hide a hardcoded label.
    expect(within(admin).getByText('Admin')).toBeInTheDocument();
    expect(within(moderator).getByText('Moderator')).toBeInTheDocument();
    expect(within(plain).getByText('User')).toBeInTheDocument();

    expect(within(admin).getByText('Ayesha Rahman')).toBeInTheDocument();
    expect(within(admin).getByText('Verified')).toBeInTheDocument();
    expect(within(admin).getByText('Active')).toBeInTheDocument();

    // The third row is unverified, deactivated, and has no `display_name`, so it
    // exercises both state labels and the name fallback at once.
    expect(within(plain).getByText('Unverified')).toBeInTheDocument();
    expect(within(plain).getByText('Deactivated')).toBeInTheDocument();
    expect(within(plain).getByText('User 31')).toBeInTheDocument();

    // A row is one link to the public profile — the same destination the feed's
    // author name uses.
    expect(within(admin).getByRole('link')).toHaveAttribute('href', '/profile/21');

    // `joined` is formatted per locale, so assert the prefix rather than a
    // string that would change every time the suite runs.
    expect(within(admin).getByText(/^Joined /)).toBeInTheDocument();
  });

  it('loads the directory once and never fans out to /users/{id}', async () => {
    let profileReads = 0;

    server.use(
      http.get(ROW_PROFILE_PATH, () => {
        profileReads += 1;
        return HttpResponse.json(errorBody('PROFILE_NOT_FOUND', 404, '/api/v1/users/31'), {
          status: 404,
        });
      }),
    );

    renderWithProviders(<UserList />);

    await ready();

    expect(rows()).toHaveLength(3);
    // The row data is already in the page, so a profile request here would be
    // three extra round trips to learn nothing.
    expect(profileReads).toBe(0);
  });

  it('treats 403 as "admins only" rather than an empty directory', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json(errorBody('FORBIDDEN', 403, '/api/v1/users'), { status: 403 }),
      ),
    );

    renderWithProviders(<UserList />);

    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The user directory is limited to administrators. If you think you should have access, ask an administrator.',
      ),
    ).toBeInTheDocument();

    // "Nobody has signed up" and "you may not see who did" are different facts,
    // so the refusal must not borrow the empty state's copy or its retry button.
    expect(screen.queryByText('No accounts')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('renders the empty state when the instance has no accounts', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ items: [], next_cursor: null })));

    renderWithProviders(<UserList />);

    expect(await screen.findByText('No accounts')).toBeInTheDocument();
    expect(screen.getByText('0 accounts')).toBeInTheDocument();
    // Nothing to page through, so no load-more control.
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('pages forward and drops an account repeated across pages', async () => {
    const user = userEvent.setup();
    const items = adminDirectory.items;

    // Page 2 deliberately re-sends `Tanvir Ahmed` (id 24). The directory is
    // keyset-paginated, so a signup between two page loads shifts the window and
    // the same account can legitimately appear twice.
    const pages = [
      { items: items.slice(0, 2), next_cursor: '2' },
      { items: items.slice(1, 3), next_cursor: null },
    ];
    let served = 0;

    server.use(
      http.get(LIST_PATH, () => {
        const page = pages[Math.min(served, pages.length - 1)];
        served += 1;
        return HttpResponse.json(page);
      }),
    );

    renderWithProviders(<UserList />);

    await ready();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('2 accounts')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByText('3 accounts')).toBeInTheDocument();

    // Duplicated ids would also mean duplicated React keys.
    expect(screen.getAllByText('Tanvir Ahmed')).toHaveLength(1);
    expect(screen.getByText('User 31')).toBeInTheDocument();

    // The second page reported no cursor, so the list is finished.
    expect(screen.getByText('No more accounts.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('keeps the loaded accounts when a next page fails', async () => {
    const user = userEvent.setup();
    let reads = 0;

    server.use(
      http.get(LIST_PATH, () => {
        reads += 1;
        if (reads === 1) {
          return HttpResponse.json({ items: adminDirectory.items.slice(0, 2), next_cursor: '2' });
        }
        // 429, not 500: `query-provider.tsx` retries 5xx twice with TanStack's
        // exponential backoff, so a 500 would surface the alert ~3s after the
        // click and the assertion would race `findBy`'s default timeout. A 4xx
        // fails on the first attempt, which is the state this test is about.
        return HttpResponse.json(errorBody('RATE_LIMITED', 429, '/api/v1/users'), {
          status: 429,
        });
      }),
    );

    renderWithProviders(<UserList />);

    await ready();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    // A failed *next page* also flips `isError`; the page-level failure branch is
    // only for "nothing loaded at all", so the rows must survive.
    expect(await screen.findByText("That page didn't load. Try again.")).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('Ayesha Rahman')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the directory")).not.toBeInTheDocument();
  });

  it('renders under the Bangla catalog', async () => {
    renderWithProviders(<UserList />, { locale: 'bn' });

    await ready();

    expect(screen.getByText('3টি অ্যাকাউন্ট')).toBeInTheDocument();
    // Both of the first two accounts are verified, so this label appears twice.
    expect(screen.getAllByText('যাচাইকৃত')).toHaveLength(2);
    expect(screen.getByText('নিষ্ক্রিয়')).toBeInTheDocument();
    expect(screen.getByText('মডারেটর')).toBeInTheDocument();
    // The name fallback is copy, so it is translated; real names are not.
    expect(screen.getByText('ব্যবহারকারী 31')).toBeInTheDocument();
    expect(screen.getByText('Ayesha Rahman')).toBeInTheDocument();
  });

  it('renders no controls on your own row, only the reason', async () => {
    renderWithProviders(<UserList />);

    await ready();

    // Row one IS `adminProfile.user_id` (21). Deactivating or demoting yourself
    // would remove the console needed to undo it, so the rule is shown rather
    // than offered and then refused.
    //
    // The lock is awaited first on purpose: `me` is a SEPARATE query from the
    // directory, so asserting its absence straight after `ready()` would read a
    // row that has not heard back from `GET /users/me` yet and flake. Once the
    // lock is on screen, "no menu here" is a real statement about the final
    // render rather than a race.
    const locked = await screen.findByRole('button', {
      name: 'This is your own account — another admin has to change it.',
    });
    expect(locked).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Actions for Ayesha Rahman' }),
    ).not.toBeInTheDocument();

    // The other two rows are other people, so they do have a menu.
    expect(screen.getByRole('button', { name: 'Actions for Tanvir Ahmed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for User 31' })).toBeInTheDocument();
  });

  it('deactivates through PATCH with only the flag that changed', async () => {
    const user = userEvent.setup();
    const calls: Array<{ id: number; body: unknown }> = [];

    server.use(
      http.patch('*/api/v1/users/:user_id', async ({ request, params }) => {
        calls.push({ id: Number(params.user_id), body: await request.json() });
        return HttpResponse.json({ ...adminDirectory.items[1], is_active: false });
      }),
    );

    renderWithProviders(<UserList />);
    await ready();

    await openMenu(user, 'Tanvir Ahmed');
    await user.click(await screen.findByRole('menuitem', { name: /Deactivate/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    // The body is `exclude_unset`, so a whole-row snapshot would be a silent role
    // reset. Only the field that actually changed may be sent.
    expect(calls[0]).toEqual({ id: 24, body: { is_active: false } });

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Tanvir Ahmed is now deactivated.'),
    );
  });

  it('activates through the named endpoint so both columns clear at once', async () => {
    const user = userEvent.setup();
    const activations: number[] = [];
    let patches = 0;

    server.use(
      http.patch('*/api/v1/users/:user_id', () => {
        patches += 1;
        return HttpResponse.json(adminDirectory.items[2]);
      }),
      http.post('*/api/v1/users/:user_id/activate', ({ params }) => {
        activations.push(Number(params.user_id));
        return HttpResponse.json({
          ...adminDirectory.items[2],
          is_active: true,
          is_verified: true,
        });
      }),
    );

    renderWithProviders(<UserList />);
    await ready();

    // Row three is the stuck signup: unverified and deactivated.
    await openMenu(user, 'User 31');
    await user.click(await screen.findByRole('menuitem', { name: /^Activate/ }));

    await waitFor(() => expect(activations).toEqual([31]));
    // A `PATCH { is_active: true }` would leave `is_verified` false — the account
    // would still be blocked on any verified-only screen.
    expect(patches).toBe(0);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('User 31 is now active.'));
  });

  it('changes a role through PATCH and names the new role', async () => {
    const user = userEvent.setup();
    const calls: Array<{ id: number; body: unknown }> = [];

    server.use(
      http.patch('*/api/v1/users/:user_id', async ({ request, params }) => {
        calls.push({ id: Number(params.user_id), body: await request.json() });
        return HttpResponse.json({ ...adminDirectory.items[1], role: 'admin' });
      }),
    );

    renderWithProviders(<UserList />);
    await ready();

    await openMenu(user, 'Tanvir Ahmed');
    await user.click(await screen.findByRole('menuitemradio', { name: 'Admin' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ id: 24, body: { role: 'admin' } });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Tanvir Ahmed is now a Admin.'));
  });

  it('deletes only after the confirmation dialog is accepted', async () => {
    const user = userEvent.setup();
    const deletions: number[] = [];

    server.use(
      http.delete('*/api/v1/users/:user_id', ({ params }) => {
        deletions.push(Number(params.user_id));
        // Soft delete: the row survives with the sign-in block set.
        return HttpResponse.json({ ...adminDirectory.items[1], is_active: false });
      }),
    );

    renderWithProviders(<UserList />);
    await ready();

    await openMenu(user, 'Tanvir Ahmed');
    await user.click(await screen.findByRole('menuitem', { name: /Delete account/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this account?')).toBeInTheDocument();
    // Choosing the item opens the dialog; it must not delete on its own.
    expect(deletions).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(deletions).toEqual([24]));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Tanvir Ahmed has been deleted.'),
    );
  });

  it('surfaces a self-action refusal in its own words', async () => {
    const user = userEvent.setup();

    // The client cannot predict every refusal — another admin may have promoted
    // this row a moment ago — so the server's code has to reach the reader.
    server.use(
      http.patch('*/api/v1/users/:user_id', () =>
        HttpResponse.json(errorBody('CANNOT_MODIFY_SELF', 403, '/api/v1/users/24'), {
          status: 403,
        }),
      ),
    );

    renderWithProviders(<UserList />);
    await ready();

    await openMenu(user, 'Tanvir Ahmed');
    await user.click(await screen.findByRole('menuitem', { name: /Deactivate/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'You cannot do this to your own account. Ask another admin.',
      ),
    );
    // A refusal must not be announced as a success.
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('surfaces the last-admin refusal instead of a generic failure', async () => {
    const user = userEvent.setup();

    server.use(
      http.patch('*/api/v1/users/:user_id', () =>
        HttpResponse.json(errorBody('LAST_ADMIN_PROTECTED', 409, '/api/v1/users/24'), {
          status: 409,
        }),
      ),
    );

    renderWithProviders(<UserList />);
    await ready();

    await openMenu(user, 'Tanvir Ahmed');
    await user.click(await screen.findByRole('menuitemradio', { name: 'User' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'At least one active admin has to remain, so this account cannot be demoted, deactivated or deleted.',
      ),
    );
  });
});
