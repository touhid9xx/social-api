import { describe, expect, it } from 'vitest';

import { defaultLocale, isLocale, locales } from './config';

describe('i18n config', () => {
  it('ships English and Bangla', () => {
    expect(locales).toEqual(['en', 'bn']);
    expect(defaultLocale).toBe('en');
  });

  it('narrows unknown cookie values back to the default locale', () => {
    expect(isLocale('bn')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });
});
