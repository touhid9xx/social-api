import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { DEMO_ADMIN_EMAIL } from '@/mocks/fixtures';

import { ForgotPasswordForm } from './forgot-password-form';

const UNKNOWN_EMAIL = 'nobody@example.com';

async function submit(email: string) {
  const user = userEvent.setup();
  renderWithProviders(<ForgotPasswordForm />);

  if (email) await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Send reset link' }));

  return user;
}

describe('ForgotPasswordForm', () => {
  it('renders the email field, the action and a way back to sign in', () => {
    renderWithProviders(<ForgotPasswordForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('blocks an empty email before the network round trip', async () => {
    await submit('');

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
  });

  it('blocks a malformed email before the network round trip', async () => {
    await submit('not-an-email');

    expect(
      await screen.findByText('That does not look like an email address.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
  });

  it('promises only that a link is on its way if the account exists', async () => {
    await submit(DEMO_ADMIN_EMAIL);

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    // The backend answers 200 for unknown addresses too, so the copy must never
    // claim "we sent you an email" — that would be an enumeration oracle by UI.
    expect(
      screen.getByText(`If ${DEMO_ADMIN_EMAIL} has an account, a reset link is on its way.`),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('answers the same way for an address with no account', async () => {
    await submit(UNKNOWN_EMAIL);

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(UNKNOWN_EMAIL))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<ForgotPasswordForm />, { locale: 'bn' });

    expect(screen.getByLabelText('ইমেইল')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'রিসেট লিংক পাঠান' })).toBeInTheDocument();
  });
});
