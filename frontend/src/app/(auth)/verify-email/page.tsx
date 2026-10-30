import { getTranslations } from 'next-intl/server';

import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';

type PageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function Page({ searchParams }: PageProps) {
  const t = await getTranslations('auth.verifyEmail');
  const { token } = await searchParams;

  // A repeated `?token=a&token=b` arrives as an array; the first one is the link
  // the user actually clicked. The panel handles the empty case itself.
  const value = Array.isArray(token) ? token[0] : token;

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </div>

      <VerifyEmailPanel token={value ?? ''} />
    </div>
  );
}
