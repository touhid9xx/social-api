import { getTranslations } from 'next-intl/server';

import { NotificationList } from '@/components/notifications/notification-list';
import { SYSTEM_SCOPE } from '@/lib/api/notifications';

/**
 * Staff alerts — the operational traffic that does not belong in a personal
 * inbox.
 *
 * `admin_new_user` is fired at every admin whenever an account is created, so
 * leaving it in `/notifications` buried the follows and replies the inbox exists
 * for, and a mark-all-read there silently swallowed the account alerts too. The
 * two are now separate slices of the same endpoint (`?scope=system` vs.
 * `?scope=social`) with separate cache entries and separate badges, and this
 * screen is the system one — the same `NotificationList` component, pointed at a
 * different scope.
 *
 * Recipient-scoped, not role-scoped: `GET /notifications` always answers for the
 * caller. Only admins are ever addressed, so a moderator sees the empty state
 * rather than an error — which is why the tab is still gated to `admin`.
 */
export default async function Page() {
  const t = await getTranslations('admin.system');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <NotificationList scope={SYSTEM_SCOPE} />
    </div>
  );
}
