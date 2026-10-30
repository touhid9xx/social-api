import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ProfileUpdate } from '@/lib/api/users';
import { renderWithProviders } from '@/lib/testing/render';
import { adminProfile } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { ProfileForm } from './profile-form';

/**
 * Settings → profile.
 *
 * The whole screen exists to get one request shape right, so that is what these
 * tests pin: `PATCH /users/me` must carry **the version that was read** and
 * **only the fields that changed**, and a field the user emptied must travel as
 * `null` rather than as `undefined`. `model_dump(exclude_unset=True)` on the
 * backend treats those as opposites — omit-and-keep versus clear — so getting it
 * backwards would make "delete my bio" silently do nothing.
 *
 * The success signal is the request body, not the toast: the `Toaster` lives in
 * the root layout, which `renderWithProviders` does not mount, so a status line
 * in the component would be the only assertable one — and this form has none.
 *
 * (খালি ঘর মানে `null`, ফাঁকা স্ট্রিং নয় — নইলে সার্ভার পুরোনো মান রেখে দিত।)
 */

const PROFILE_PATH = '*/api/v1/users/me';

/** Count PATCHes and echo a contract-shaped `ProfileSelf` with the lock bumped. */
function capturePatch() {
  const seen: { calls: number; body?: ProfileUpdate } = { calls: 0 };

  server.use(
    http.patch(PROFILE_PATH, async ({ request }) => {
      seen.calls += 1;
      seen.body = (await request.json()) as ProfileUpdate;
      return HttpResponse.json({ ...adminProfile, version: adminProfile.version + 1 });
    }),
  );

  return seen;
}

/** Count `GET /users/me` — how a refetch becomes observable. */
function countReads() {
  const seen = { calls: 0 };

  server.use(
    http.get(PROFILE_PATH, () => {
      seen.calls += 1;
      return HttpResponse.json(adminProfile);
    }),
  );

  return seen;
}

function save() {
  return screen.getByRole('button', { name: 'Save changes' });
}

describe('ProfileForm', () => {
  it('seeds every control from the profile that was read', async () => {
    renderWithProviders(<ProfileForm />);

    expect(await screen.findByLabelText('Display name')).toHaveValue('Admin');
    expect(screen.getByLabelText('Bio')).toHaveValue('Runs the place.');
    expect(screen.getByLabelText('Location')).toHaveValue('Dhaka');
    expect(screen.getByLabelText('Website')).toHaveValue('');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.getByLabelText('Date of birth')).toHaveValue('');
    expect(screen.getByLabelText('Profile visibility')).toHaveValue('public');
    // The private-by-default PII column, which must not be conflated with the
    // public `visibility` above — they are separate switches on the backend.
    expect(screen.getByLabelText('Personal details visibility')).toHaveValue('private');
  });

  it('sends only the changed field, locked to the version that was read', async () => {
    const user = userEvent.setup();
    const seen = capturePatch();
    renderWithProviders(<ProfileForm />);

    const bio = await screen.findByLabelText('Bio');
    await user.clear(bio);
    await user.type(bio, 'Now editing in settings.');
    await user.click(save());

    await waitFor(() => expect(seen.calls).toBe(1));
    // `extra="forbid"`, so shipping the untouched fields would be noise at best.
    expect(seen.body).toEqual({ version: 1, bio: 'Now editing in settings.' });
  });

  it('sends an emptied field as null, not as a missing key', async () => {
    const user = userEvent.setup();
    const seen = capturePatch();
    renderWithProviders(<ProfileForm />);

    await user.clear(await screen.findByLabelText('Display name'));
    await user.clear(screen.getByLabelText('Bio'));
    await user.click(save());

    await waitFor(() => expect(seen.calls).toBe(1));
    // An omitted key means "leave it alone" to the backend; `null` means clear.
    expect(seen.body).toEqual({ version: 1, display_name: null, bio: null });
  });

  it('refuses a non-http website before it reaches the API', async () => {
    const user = userEvent.setup();
    const seen = capturePatch();
    renderWithProviders(<ProfileForm />);

    // `z.string().url()` would accept this; `HttpUrl` and the schema must not.
    await user.type(await screen.findByLabelText('Website'), 'javascript:alert(1)');
    await user.click(save());

    expect(
      await screen.findByText('Enter a full URL starting with http:// or https://.'),
    ).toBeInTheDocument();
    expect(seen.calls).toBe(0);
  });

  it('offers a reload when the optimistic lock is stale', async () => {
    const user = userEvent.setup();
    const reads = countReads();
    const conflict: ApiErrorBody = {
      error: 'VERSION_CONFLICT',
      status: 409,
      detail: 'profile version mismatch',
      path: '/api/v1/users/me',
      request_id: 'test-request-id',
    };
    server.use(http.patch(PROFILE_PATH, () => HttpResponse.json(conflict, { status: 409 })));

    renderWithProviders(<ProfileForm />);

    const bio = await screen.findByLabelText('Bio');
    await user.clear(bio);
    await user.type(bio, 'Saving against a stale lock');
    await user.click(save());

    // 409 -> errors.versionConflict, never the raw code.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was changed somewhere else. Reload and try again.',
    );
    // The user's typing survives the failure; only the lock is stale.
    expect(bio).toHaveValue('Saving against a stale lock');
    await waitFor(() => expect(reads.calls).toBe(1));

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    // Reload is the mechanical fix, so it has to actually refetch the profile.
    await waitFor(() => expect(reads.calls).toBe(2));
  });

  it('renders Bangla labels under the bn locale', async () => {
    renderWithProviders(<ProfileForm />, { locale: 'bn' });

    expect(await screen.findByLabelText('প্রদর্শিত নাম')).toBeInTheDocument();
    expect(screen.getByLabelText('বায়ো')).toBeInTheDocument();
    expect(screen.getByLabelText('প্রোফাইল দৃশ্যমানতা')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পরিবর্তন সংরক্ষণ করুন' })).toBeInTheDocument();
  });
});
