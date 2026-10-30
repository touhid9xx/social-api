'use client';

import { useTranslations } from 'next-intl';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('errorTitle')}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('errorBody')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">digest: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {t('retry')}
      </button>
    </main>
  );
}
