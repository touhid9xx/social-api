'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useHomeFeed } from '@/hooks/use-home-feed';
import { useInView } from '@/hooks/use-in-view';
import type { FeedPost } from '@/lib/api/feed';

import { PostCard } from './post-card';

/**
 * The loaded feed: pages in, one flat list out.
 *
 * Cursor pagination is not order-stable under concurrent writes — a post
 * inserted while the user scrolls can appear on two pages — so duplicates are
 * dropped by id. React needs the same guarantee for its keys, and a user
 * scrolling should not read the same post twice.
 */
function flattenPages(pages: Array<{ items: FeedPost[] }>): FeedPost[] {
  const seen = new Set<number>();
  const posts: FeedPost[] = [];

  for (const page of pages) {
    for (const post of page.items) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }

  return posts;
}

function FeedSkeleton() {
  const t = useTranslations('feed');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t('loadingFeed')}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * `GET /api/v1/feed/home`, rendered as an endless list.
 *
 * Two ways to ask for the next page, and both matter:
 *  - an IntersectionObserver sentinel, for the pointer/touch case;
 *  - a real `<button>`, because a sentinel is invisible to keyboard users,
 *    screen readers and anyone whose browser lacks the observer. Infinite
 *    scroll must never be the only route to content.
 *
 * The button is also what the tests drive: jsdom has no observer, so the
 * assertions exercise the same code path a keyboard user takes.
 */
export function HomeFeed() {
  const t = useTranslations('feed');
  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useHomeFeed();

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  if (isPending) return <FeedSkeleton />;

  const posts = data ? flattenPages(data.pages) : [];

  // A failed *next page* also flips `isError`, so the page-level failure is
  // only rendered when nothing loaded at all. Otherwise the posts already on
  // screen stay put and the failure is reported inline next to "Load more".
  if (isError && posts.length === 0) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h2 className="text-base font-semibold text-foreground">{t('errorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {t('retry')}
        </Button>
        <p className="sr-only">{error instanceof Error ? error.message : ''}</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-border p-8 text-center">
        <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>

      {hasNextPage ? (
        <div className="space-y-3">
          {/* Zero-height sentinel: it must cost no layout, and it is purely a
              scroll hint, so it stays out of the accessibility tree. */}
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

          <div className="flex flex-col items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void fetchNextPage()}
              disabled={!canLoadMore}
              aria-busy={isFetchingNextPage}
            >
              {isFetchingNextPage ? t('loadingMore') : t('loadMore')}
            </Button>

            {isFetchNextPageError ? (
              <p role="alert" className="text-xs text-destructive">
                {t('loadMoreFailed')}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('endOfFeed')}</p>
      )}
    </div>
  );
}
