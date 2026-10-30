import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders a native button with the default variant', () => {
    render(<Button>Publish</Button>);

    const button = screen.getByRole('button', { name: 'Publish' });

    expect(button).toHaveAttribute('data-variant', 'default');
    expect(button).toHaveAttribute('data-size', 'default');
    expect(button.className).toContain('bg-primary');
  });

  it('maps every variant to its own token classes', () => {
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-destructive');
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(buttonVariants({ variant: 'outline' })).toContain('bg-background');
    expect(buttonVariants({ variant: 'ghost' })).toContain('hover:bg-accent');
    expect(buttonVariants({ variant: 'link' })).toContain('underline-offset-4');
  });

  it('renders as the child element when asChild is set', () => {
    render(
      <Button asChild variant="outline">
        <a href="/home">Home</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Home' });

    expect(link).toHaveAttribute('href', '/home');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('fires a click handler once', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Like</Button>);
    await user.click(screen.getByRole('button', { name: 'Like' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
