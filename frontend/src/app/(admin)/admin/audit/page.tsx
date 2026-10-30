import { getTranslations } from 'next-intl/server';

import { AuditLog } from '@/components/admin/audit-log';

/**
 * The admin audit trail.
 *
 * Admin-only server-side (`require_roles(ADMIN)`); the client renders and lets a
 * `403` become the "admins only" state, since the frontend has no role to check.
 */
export default async function Page() {
  const t = await getTranslations('admin.audit');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <AuditLog />
    </div>
  );
}
