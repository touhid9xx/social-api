import { getTranslations } from 'next-intl/server';

import { ExploreFeed } from '@/components/feed/explore-feed';

/**
 * The discovery feed.
 *
 * Same shape as `/home`: the heading is translated on the server, the body is a
 * client component because the feed is fetched with the in-memory access token
 * and paginated as the user scrolls.
 */
export default async function Page() {
  const t = await getTranslations('feed.explore');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <ExploreFeed />
    </div>
  );
}
