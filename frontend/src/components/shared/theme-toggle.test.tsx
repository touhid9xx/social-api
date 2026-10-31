import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';

import { ThemeToggle } from './theme-toggle';

/**
 * The control is icon-only, so every assertion goes through the accessible name:
 * if a name regresses, the buttons are unlabelled pictures and these tests fail.
 */
function group() {
  return screen.getByRole('group', { name: 'Theme' });
}

describe('ThemeToggle', () => {
  it('renders one icon button per mode inside a labelled group', () => {
    renderWithProviders(<ThemeToggle />);

    const buttons = within(group()).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Theme: Light',
      'Theme: Dark',
      'Theme: System',
    ]);
  });

  it('never shows the mode as visible text — icons only', () => {
    renderWithProviders(<ThemeToggle />);

    // Each button's textContent must be empty: an icon, a label attribute, no words.
    for (const button of within(group()).getAllByRole('button')) {
      expect(button).toHaveTextContent('');
    }
  });

  it('marks the system default as pressed without any interaction', async () => {
    renderWithProviders(<ThemeToggle />);

    // Pressed state is mount-gated to avoid a hydration mismatch; it appears
    // after the effect, so assert asynchronously.
    await waitFor(() => {
      expect(within(group()).getByRole('button', { name: 'Theme: System' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(within(group()).getByRole('button', { name: 'Theme: Light' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(group()).getByRole('button', { name: 'Theme: Dark' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reaches any mode in a single press and moves the pressed state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    await user.click(within(group()).getByRole('button', { name: 'Theme: Dark' }));
    await waitFor(() => {
      expect(within(group()).getByRole('button', { name: 'Theme: Dark' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(within(group()).getByRole('button', { name: 'Theme: System' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // One press to light — not a cycle through dark → system → light.
    await user.click(within(group()).getByRole('button', { name: 'Theme: Light' }));
    await waitFor(() => {
      expect(within(group()).getByRole('button', { name: 'Theme: Light' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(within(group()).getByRole('button', { name: 'Theme: Dark' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('labels the buttons in Bangla under the bn locale', () => {
    renderWithProviders(<ThemeToggle />, { locale: 'bn' });

    const buttons = within(screen.getByRole('group', { name: 'থিম' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'থিম: লাইট',
      'থিম: ডার্ক',
      'থিম: সিস্টেম',
    ]);
  });
});
