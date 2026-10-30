import { getTranslations } from 'next-intl/server';

import { SettingsTabs } from '@/components/settings/settings-tabs';

/**
 * Account settings: profile, consent, and data/privacy.
 *
 * The heading is translated on the server; the tab panels are client-side because
 * they read the in-memory access token and write to the API. Nothing here is
 * pre-fetched — each panel owns its own query, so the screen paints immediately
 * and the three sections fail independently.
 */
export default async function Page() {
  const t = await getTranslations('settings');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <SettingsTabs />
    </div>
  );
}
