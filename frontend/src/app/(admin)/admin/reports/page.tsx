import { getTranslations } from 'next-intl/server';

import { ReportList } from '@/components/admin/report-list';

/**
 * The moderation report queue.
 *
 * The heading is translated on the server; the queue is client-side because it
 * reads the in-memory access token, filters by status and paginates on scroll.
 * Authorization is deliberately not attempted here — `ProfileSelf` carries no
 * role, so the `403` from the endpoint is what tells the screen it is off-limits.
 */
export default async function Page() {
  const t = await getTranslations('admin.reports');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ReportList />
    </div>
  );
}
