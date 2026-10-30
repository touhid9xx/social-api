import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { QueryProvider } from '@/components/shared/query-provider';
import { ThemeProvider } from '@/components/shared/theme-provider';
import type { Locale } from '@/i18n/config';

import bn from '../../../messages/bn.json';
import en from '../../../messages/en.json';

const catalogs: Record<Locale, typeof en> = { en, bn };

type ProviderOptions = Omit<RenderOptions, 'wrapper'> & {
  /** Locale for the i18n provider; defaults to `en` like the app default. */
  locale?: Locale;
};

/**
 * Render a component with the same providers the root layout installs
 * (next-themes + next-intl). Components that call `useTranslations` or `useTheme`
 * cannot be rendered bare, so always prefer this over `render`.
 *
 * (real layout-এর মতো same provider দিয়ে render করলে test আর app একই behaviour দেখে।)
 */
export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const { locale = 'en', ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="UTC">
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </ThemeProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
