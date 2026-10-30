import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PostDetail } from '@/components/feed/post-detail';

/**
 * `/posts/[id]` — one post and its comment thread.
 *
 * The id is validated on the server before anything is fetched: `Number('12abc')`
 * is NaN, `'1.5'` is not a post id, and `/posts/0` cannot exist. A malformed id
 * is a 404 from Next rather than a request to the backend that can only fail.
 *
 * The page itself is a server component so the heading renders translated; the
 * data below it is client-side because every read carries the in-memory access
 * token.
 */
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const postId = Number(id);

  if (!Number.isInteger(postId) || postId <= 0) notFound();

  const t = await getTranslations('feed.postDetail');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PostDetail postId={postId} />
    </div>
  );
}
