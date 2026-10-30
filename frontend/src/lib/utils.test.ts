import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('flex', 'items-center')).toBe('flex items-center');
    expect(cn('flex', false, undefined, null, 'gap-2')).toBe('flex gap-2');
  });

  it('lets the last conflicting Tailwind utility win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm text-muted-foreground', 'text-base')).toBe(
      'text-muted-foreground text-base',
    );
  });

  it('accepts conditional objects', () => {
    expect(cn({ 'opacity-50': true, 'pointer-events-none': false }, 'font-medium')).toBe(
      'opacity-50 font-medium',
    );
  });
});
