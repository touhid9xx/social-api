import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MessageThread } from '@/components/chat/message-thread';

/**
 * `/messages/[roomId]` — one conversation.
 *
 * The id is validated before anything is fetched, exactly as `/posts/[id]` does:
 * `Number('12abc')` is NaN, `'1.5'` is not a room id and `/messages/0` cannot
 * exist, so a malformed segment is a 404 from Next rather than a request that can
 * only fail. Membership is NOT checked here — the backend answers 404/403 for a
 * room the caller is not in, and `MessageThread` renders that as "unavailable".
 */
type PageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { roomId } = await params;
  const id = Number(roomId);

  if (!Number.isInteger(id) || id <= 0) notFound();

  const t = await getTranslations('chat.page');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <h1 className="sr-only">{t('threadTitle')}</h1>

      <MessageThread roomId={id} />
    </div>
  );
}
