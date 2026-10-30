import { getTranslations } from 'next-intl/server';

import { RoomList } from '@/components/chat/room-list';

/**
 * The conversation list.
 *
 * The heading is translated on the server; the list is client-side because every
 * read carries the in-memory access token.
 */
export default async function Page() {
  const t = await getTranslations('chat.page');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <RoomList />
    </div>
  );
}
