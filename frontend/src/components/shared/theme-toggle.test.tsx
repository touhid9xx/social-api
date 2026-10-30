import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';

import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  it('cycles system → light → dark → system and announces the state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName('Theme: System');
    expect(button).toHaveAttribute('title', 'Theme: System');

    await user.click(button);
    expect(button).toHaveAccessibleName('Theme: Light');

    await user.click(button);
    expect(button).toHaveAccessibleName('Theme: Dark');

    await user.click(button);
    expect(button).toHaveAccessibleName('Theme: System');
  });

  it('renders Bangla copy when the locale is bn', () => {
    renderWithProviders(<ThemeToggle />, { locale: 'bn' });

    expect(screen.getByRole('button')).toHaveAccessibleName('থিম: সিস্টেম');
  });
});
