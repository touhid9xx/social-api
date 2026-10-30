import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { clearTokens, getAccessToken } from '@/lib/api';
import { PASSWORD_MIN_LENGTH } from '@/lib/validation/auth';
import { renderWithProviders } from '@/lib/testing/render';
import { DEMO_ADMIN_EMAIL, DEMO_PASSWORD } from '@/mocks/fixtures';

import { RegisterForm } from './register-form';

const FRESH_EMAIL = 'newcomer@example.com';

beforeEach(() => {
  clearTokens();
});

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  renderWithProviders(<RegisterForm />);

  if (email) await user.type(screen.getByLabelText('Email'), email);
  if (password) await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));

  return user;
}

/** The five policy rows, in `PASSWORD_RULES` order. */
function ruleItems() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

describe('RegisterForm', () => {
  it('renders both fields, the action and the full password policy checklist', () => {
    renderWithProviders(<RegisterForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(ruleItems()).toHaveLength(5);
    expect(screen.getByText(`At least ${PASSWORD_MIN_LENGTH} characters`)).toBeInTheDocument();
  });

  it('blocks an empty email before the network round trip', async () => {
    await submit('', DEMO_PASSWORD);

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
  });

  it('rejects a password shorter than the backend minimum client-side', async () => {
    await submit(FRESH_EMAIL, 'Abc1!');

    expect(
      await screen.findByText(`Use at least ${PASSWORD_MIN_LENGTH} characters.`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
  });

  it('rejects a long-but-weak password with the policy message', async () => {
    await submit(FRESH_EMAIL, 'alllowercasepassword');

    expect(
      await screen.findByText(
        'Add an uppercase letter, a lowercase letter, a number and a symbol.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
  });

  it('swaps the form for the inbox panel on 201, without storing a session', async () => {
    await submit(FRESH_EMAIL, DEMO_PASSWORD);

    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(FRESH_EMAIL))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');

    // Contract: register answers 201 with `{ user, message }` and NO tokens.
    expect(getAccessToken()).toBeNull();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('maps 409 EMAIL_ALREADY_REGISTERED through the shared error catalog', async () => {
    await submit(DEMO_ADMIN_EMAIL, DEMO_PASSWORD);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists.',
    );
    expect(screen.queryByText('Check your inbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('flips the policy checklist rows as the password satisfies them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RegisterForm />);

    // Nothing typed yet: every clause is unmet.
    for (const item of ruleItems()) expect(within(item).getByText('not met')).toBeInTheDocument();

    // 12 chars, mixed case, digit, symbol -> every clause met.
    await user.type(screen.getByLabelText('Password'), DEMO_PASSWORD);

    await waitFor(() => {
      for (const item of ruleItems()) expect(within(item).getByText('met')).toBeInTheDocument();
    });
  });

  it('renders Bangla labels under the bn locale', () => {
    renderWithProviders(<RegisterForm />, { locale: 'bn' });

    expect(screen.getByLabelText('ইমেইল')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'অ্যাকাউন্ট তৈরি করুন' })).toBeInTheDocument();
  });
});
