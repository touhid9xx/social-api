import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { VERIFY_EMAIL_TOKEN } from '@/mocks/fixtures';

import { VerifyEmailPanel } from './verify-email-panel';

/**
 * The verification panel runs on MOUNT, not on submit: the endpoint consumes the
 * token, so there is nothing for the user to press.
 *
 * The mock accepts only `VERIFY_EMAIL_TOKEN` and answers a real 401
 * `INVALID_TOKEN` for anything else, which is exactly what the backend does with
 * an expired, already-used or forged link — the branch most users actually hit.
 */
describe('VerifyEmailPanel', () => {
  it('verifies the token on mount and offers a sign-in link', async () => {
    renderWithProviders(<VerifyEmailPanel token={VERIFY_EMAIL_TOKEN} />);

    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the verifying state before the response lands', () => {
    renderWithProviders(<VerifyEmailPanel token={VERIFY_EMAIL_TOKEN} />);

    expect(screen.getByRole('status')).toHaveTextContent('Verifying your email…');
  });

  it('maps 401 INVALID_TOKEN through the shared error catalog', async () => {
    renderWithProviders(<VerifyEmailPanel token="expired-or-forged" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This link is invalid or has expired.',
    );
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('never posts when the link carries no token at all', () => {
    renderWithProviders(<VerifyEmailPanel token="" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link is missing its token. Open the link from your inbox again.',
    );
    // The query is disabled, so the spinner must not appear.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', () => {
    renderWithProviders(<VerifyEmailPanel token="" />, { locale: 'bn' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'এই লিংকে কোনো টোকেন নেই। ইনবক্সের লিংকটি আবার খুলুন।',
    );
    expect(screen.getByRole('link', { name: 'সাইন ইনে যান' })).toBeInTheDocument();
  });
});
