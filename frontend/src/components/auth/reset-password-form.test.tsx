import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH } from '@/lib/validation/auth';
import { renderWithProviders } from '@/lib/testing/render';
import { DEMO_PASSWORD, RESET_PASSWORD_TOKEN } from '@/mocks/fixtures';

import { ResetPasswordForm } from './reset-password-form';

async function submit(token: string, password: string) {
  const user = userEvent.setup();
  renderWithProviders(<ResetPasswordForm token={token} />);

  if (password) await user.type(screen.getByLabelText('New password'), password);
  await user.click(screen.getByRole('button', { name: 'Update password' }));

  return user;
}

/** The five policy rows, in `PASSWORD_RULES` order. */
function ruleItems() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

describe('ResetPasswordForm', () => {
  it('renders the password field, the action and the full policy checklist', () => {
    renderWithProviders(<ResetPasswordForm token={RESET_PASSWORD_TOKEN} />);

    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
    expect(ruleItems()).toHaveLength(5);
    expect(screen.getByText(`At least ${PASSWORD_MIN_LENGTH} characters`)).toBeInTheDocument();
  });

  it('rejects a password the backend policy would refuse, client-side', async () => {
    await submit(RESET_PASSWORD_TOKEN, 'alllowercasepassword');

    expect(
      await screen.findByText(
        'Add an uppercase letter, a lowercase letter, a number and a symbol.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
  });

  it('exchanges a valid token for a new password and points at sign in', async () => {
    await submit(RESET_PASSWORD_TOKEN, DEMO_PASSWORD);

    expect(await screen.findByText('Password updated')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('maps 401 INVALID_TOKEN through the shared error catalog', async () => {
    await submit('expired-or-forged', DEMO_PASSWORD);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is invalid or has expired.',
    );
    expect(screen.queryByText('Password updated')).not.toBeInTheDocument();
    // The form stays usable so the user can retry after requesting a fresh link.
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('offers a new link instead of a doomed form when the token is missing', () => {
    renderWithProviders(<ResetPasswordForm token="" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This reset link is missing its token. Request a new one.',
    );
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('flips the policy checklist rows as the password satisfies them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResetPasswordForm token={RESET_PASSWORD_TOKEN} />);

    for (const item of ruleItems()) expect(within(item).getByText('not met')).toBeInTheDocument();

    await user.type(screen.getByLabelText('New password'), DEMO_PASSWORD);

    await waitFor(() => {
      for (const item of ruleItems()) expect(within(item).getByText('met')).toBeInTheDocument();
    });
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<ResetPasswordForm token={RESET_PASSWORD_TOKEN} />, { locale: 'bn' });

    expect(screen.getByLabelText('নতুন পাসওয়ার্ড')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পাসওয়ার্ড আপডেট করুন' })).toBeInTheDocument();
  });
});
