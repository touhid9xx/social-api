'use client';

import { ImageOff, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { flattenFeedPages } from '@/components/feed/post-feed';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorPosts } from '@/hooks/use-author-posts';
import { useInView } from '@/hooks/use-in-view';
import { useMe } from '@/hooks/use-me';
import { mediaUrl, type MediaView } from '@/lib/api/media';
import { ROUTES } from '@/lib/constants';

/**
 * `/profile/[id]/gallery` — every image this person has posted, as a grid.
 *
 * There is no gallery table on the backend and no endpoint of its own. A gallery
 * *is* a projection of the posts the viewer is already allowed to see: take the
 * author's paginated posts, keep the attachments whose `kind` is `image`, and
 * lay them out. That is deliberate —
 *
 *  - visibility is inherited for free. `GET /posts/by-author/{id}` already
 *    applies the same rules as the profile page, so a private account's gallery
 *    cannot leak a photo the feed would have hidden. A separate gallery endpoint
 *    would need its own copy of that policy, and the first time the two drifted
 *    there would be a data leak;
 *  - the images keep their post as provenance. Every tile links to the post it
 *    came from, so a picture is never context-free.
 *
 * Pagination is the same cursor the feed uses, so a gallery is not capped at one
 * page: the "Load more" button (and the observer sentinel, as an accelerator)
 * ask for the next page of *posts* and re-derive the tiles.
 *
 * (আলাদা গ্যালারি টেবিল নেই — পোস্টের ছবিগুলোকেই গ্রিডে দেখানো হয়, ফলে দৃশ্যমানতার
 *  নিয়ম আলাদা করে লেখার দরকার হয় না।)
 *
 * Empty state is self-aware: on your own gallery it points at the composer, on
 * someone else's it just says there is nothing here yet.
 */
export function ProfileGallery({ userId }: { userId: number }) {
  const t = useTranslations('profile.gallery');
  const posts = useAuthorPosts(userId);
  const { data: me } = useMe();

  const {
    data,
    isPending,
    isError,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = posts;

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const isSelf = me?.user_id === userId;
  const items = data ? imagesOf(data.pages) : [];

  return (
    <section aria-label={t('title')} className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {isPending ? (
        <div aria-busy="true" aria-live="polite" className="space-y-4">
          <span className="sr-only">{t('loading')}</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : isError && items.length === 0 ? (
        // A failed *next page* also flips `isError`; the tiles already loaded stay
        // on screen and the failure is reported next to "Load more" instead.
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <h2 className="text-base font-semibold text-foreground">{t('errorTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('errorBody')}</p>
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {t('retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border p-8 text-center">
          <ImageOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {isSelf ? t('emptyBodySelf') : t('emptyBody')}
          </p>
          {isSelf ? (
            <Button asChild variant="outline" size="sm">
              <Link href={ROUTES.home}>
                <Plus aria-hidden="true" />
                {t('emptyAction')}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* The list is named and the count announced once; each tile's own
              label is positional, because the backend stores no alt text for an
              upload and inventing prose from a filename would be worse than
              saying which photo in the order it is. */}
          <ul
            aria-label={t('gridLabel', { count: items.length })}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {items.map(({ media, postId }, index) => (
              <li key={media.id}>
                <Link
                  href={`${ROUTES.posts}/${String(postId)}`}
                  aria-label={t('openPost', { index: index + 1 })}
                  className="block overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- backend-hosted URL that may sit on another origin; next/image would need a remotePatterns entry per deployment */}
                  <img
                    src={mediaUrl(media.url)}
                    alt={t('imageAlt', { index: index + 1 })}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </Link>
              </li>
            ))}
          </ul>

          {hasNextPage ? (
            <div className="space-y-3">
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
            <p className="py-4 text-center text-xs text-muted-foreground">{t('endOfGallery')}</p>
          )}
        </>
      )}

      <Link
        href={`${ROUTES.profile}/${String(userId)}`}
        className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t('backToProfile')}
      </Link>
    </section>
  );
}

/**
 * Posts in, image tiles out.
 *
 * Two deduplications, for two different reasons: posts are deduplicated by id
 * exactly like the feed (`flattenFeedPages`) because cursor pagination is not
 * order-stable under concurrent writes, and attachments are deduplicated by
 * media id because the backend deduplicates *bytes* per owner — re-posting the
 * same picture returns the same row, so it can legitimately appear twice.
 */
function imagesOf(
  pages: Array<{ items: Parameters<typeof flattenFeedPages>[0][number]['items'] }>,
) {
  const seen = new Set<number>();
  const images: Array<{ media: MediaView; postId: number }> = [];

  for (const post of flattenFeedPages(pages)) {
    for (const media of post.media ?? []) {
      if (media.kind !== 'image') continue;
      if (seen.has(media.id)) continue;
      seen.add(media.id);
      images.push({ media, postId: post.id });
    }
  }

  return images;
}
