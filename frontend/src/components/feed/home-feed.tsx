'use client';

import { useTranslations } from 'next-intl';

import { useHomeFeed } from '@/hooks/use-home-feed';

import { PostComposer } from './post-composer';
import { PostFeed } from './post-feed';

/**
 * The signed-in home feed page body: composer on top, endless list below.
 *
 * The composer sits OUTSIDE `PostFeed` on purpose. On every early return — first
 * load, feed error, empty feed — the list is replaced by a state, and the writer
 * must still be able to post. Nesting it inside would hide the composer exactly
 * when the feed has nothing in it and a new post is most useful.
 *
 * (খালি ফিডেও composer দেখা যায় — লেখার সুযোগ কখনও আটকায় না।)
 */
export function HomeFeed() {
  const t = useTranslations('feed');
  const feed = useHomeFeed();

  return (
    <div className="space-y-6">
      <PostComposer />
      <PostFeed
        query={feed}
        loadingLabel={t('loadingFeed')}
        emptyTitle={t('emptyTitle')}
        emptyBody={t('emptyBody')}
      />
    </div>
  );
}
