import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/shared/theme-toggle';
import { ROUTES } from '@/lib/constants';

/**
 * Shell shared by every auth screen (login, register, verify, forgot/reset).
 *
 * Centred card, brand link home and the theme toggle — same visual language as
 * the landing header, so moving between `/` and `/login` is not a different app.
 * `id="main"` is the target of the root layout's skip-link.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('app');

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <Link href={ROUTES.landing} className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
            >
              S
            </span>
            <span className="text-foreground">{t('name')}</span>
          </Link>

          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
