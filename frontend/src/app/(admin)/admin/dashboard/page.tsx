import { getTranslations } from 'next-intl/server';

import { Dashboard } from '@/components/admin/dashboard';

/**
 * The admin overview.
 *
 * Admin-only server-side (`require_roles(ADMIN)`); the client renders and lets a
 * `403` become the "admins only" state, since the frontend has no role to check.
 *
 * The page is wider than the audit trail's `max-w-2xl`: it is a grid of counters
 * and two numeric tables, and squeezing those into a single reading column would
 * force horizontal scrolling instead of a two-column layout.
 */
export default async function Page() {
  const t = await getTranslations('admin.dashboard');

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Dashboard />
    </div>
  );
}
