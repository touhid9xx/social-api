import { getTranslations } from 'next-intl/server';

import { FlagList } from '@/components/admin/flag-list';

/**
 * The admin flag console — the app's only consumer of `/api/v1/flags`.
 *
 * Both flags endpoints are admin-only server-side (`require_roles(ADMIN)`); the
 * client renders and lets a `403` become the "admins only" state, since the
 * frontend has no role to check.
 */
export default async function Page() {
  const t = await getTranslations('admin.flags');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <FlagList />
    </div>
  );
}
