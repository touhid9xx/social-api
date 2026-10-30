'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePost } from '@/hooks/use-post';
import { isAppApiError } from '@/lib/api';
import { ROUTES } from '@/lib/constants';

import { CommentForm } from './comment-form';
import { CommentThread } from './comment-thread';
import { PostCard } from './post-card';

/**
 * One post plus its comments.
 *
 * The post is fetched with `GET /posts/{id}` rather than found in the feed cache:
 * the route must work on a cold load (a shared link, a refresh), and a post can
 * be reachable here without ever appearing in the reader's home feed.
 *
 * The composer sits outside the thread's loading/error branches for the same
 * reason it does on the feed — a thread that failed to load must not take the
 * ability to comment down with it.
 *
 * A 404 is rendered as "not found", not as a retryable error: retrying a missing
 * post can only produce the same 404, and `PostView` access is also denied with
 * 404 for private posts, so the two cases are indistinguishable by design.
 *
 * (404 আলাদা করে দেখানো হয় — আবার চেষ্টা করলে ফল একই হবে।)
 */
export function PostDetail({ postId }: { postId: number }) {
  const t = useTranslations('feed.postDetail');
  const tFeed = useTranslations('feed');
  const { data: post, isPending, isError, error, isFetching, refetch } = usePost(postId);

  const backLink = (
    <Link
      href={ROUTES.home}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {t('backToFeed')}
    </Link>
  );

  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">{t('loading')}</span>
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    );
  }

  if (isError || !post) {
    const notFound = isAppApiError(error) && error.status === 404;

    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <h2 className="text-base font-semibold text-foreground">
            {notFound ? t('notFoundTitle') : t('errorTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {notFound ? t('notFoundBody') : t('errorBody')}
          </p>

          {notFound ? null : (
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              {tFeed('retry')}
            </Button>
          )}
        </div>

        {backLink}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {backLink}

      <PostCard post={post} />

      <section aria-label={tFeed('comments.title')} className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {tFeed('comments.title')}
        </h2>

        <CommentForm postId={postId} />

        <CommentThread postId={postId} />
      </section>
    </div>
  );
}
