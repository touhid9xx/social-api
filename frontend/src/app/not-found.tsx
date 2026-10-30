import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ROUTES } from '@/lib/constants';

export default async function NotFound() {
  const t = await getTranslations('common');

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t('notFoundTitle')}
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('notFoundBody')}</p>
      <Link
        href={ROUTES.landing}
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {t('backToHome')}
      </Link>
    </main>
  );
}
