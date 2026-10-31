import { getTranslations } from 'next-intl/server';

import { UserList } from '@/components/admin/user-list';

/**
 * The staff-only user directory.
 *
 * Admin-only server-side (`require_roles(ADMIN)`); this shell renders and lets a
 * `403` become the "admins only" state, because the frontend has no role to
 * check before the request is made — the role comes back with the token and the
 * server remains the authority.
 */
export default async function Page() {
  const t = await getTranslations('admin.users');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <UserList />
    </div>
  );
}
