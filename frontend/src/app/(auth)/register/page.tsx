import { getTranslations } from 'next-intl/server';

import { RegisterForm } from '@/components/auth/register-form';

export default async function Page() {
  const t = await getTranslations('auth.register');

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </div>

      <RegisterForm />
    </div>
  );
}
