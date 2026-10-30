'use client';

import { useTranslations } from 'next-intl';

import { useExploreFeed } from '@/hooks/use-explore-feed';

import { PostFeed } from './post-feed';

/**
 * The discovery feed page body.
 *
 * Deliberately NO composer: exploring is for finding people and posts, and the
 * home feed is where you write. Putting a composer here would duplicate the one
 * entry point for publishing and make the two pages look interchangeable when
 * they answer different questions.
 *
 * Empty copy differs from the home feed for the same reason: an empty home feed
 * means "follow someone", while an empty explore feed means the discovery
 * corpus has nothing for this viewer yet — telling them to follow people there
 * would be advice they already took.
 */
export function ExploreFeed() {
  const t = useTranslations('feed.explore');
  const tFeed = useTranslations('feed');
  const feed = useExploreFeed();

  return (
    <PostFeed
      query={feed}
      loadingLabel={tFeed('loadingFeed')}
      emptyTitle={t('emptyTitle')}
      emptyBody={t('emptyBody')}
    />
  );
}
