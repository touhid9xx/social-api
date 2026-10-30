'use client';

import { useTranslations } from 'next-intl';

import { PostFeed } from '@/components/feed/post-feed';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import { useAuthorPosts } from '@/hooks/use-author-posts';
import { isAppApiError } from '@/lib/api';

import { ProfileHeader } from './profile-header';

/**
 * `/profile/[id]` — a public profile and that person's posts.
 *
 * Two independent reads sit on this screen and are kept independent on purpose:
 *
 *  1. the profile (`GET /users/{id}`), which decides what the page IS — a 404
 *     means this user does not exist, a 403 means the profile is private or
 *     followers-only and the viewer is neither;
 *  2. the posts (`GET /posts/by-author/{id}`).
 *
 * The posts list is therefore only mounted once the profile resolved. Fetching
 * it eagerly would produce a second error for a profile that does not exist, and
 * "no posts" for a profile that was never readable — two misleading states for
 * one cause.
 *
 * A 404/403 is rendered as a plain explanation without a retry button: retrying
 * either can only produce the same answer.
 *
 * (404 আর 403 আলাদা করে দেখানো হয় — আবার চেষ্টা করলে ফল একই হবে।)
 */
export function ProfilePage({ userId }: { userId: number }) {
  const t = useTranslations('profile');
  const tFeed = useTranslations('feed');
  const { data: profile, isPending, isError, error, isFetching, refetch } = useAuthor(userId);

  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">{t('loadingProfile')}</span>
        <div className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      </div>
    );
  }

  if (isError || !profile) {
    const status = isAppApiError(error) ? error.status : 0;
    const notFound = status === 404;
    const restricted = status === 403;

    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-border bg-card p-6 text-center"
      >
        <h1 className="text-base font-semibold text-foreground">
          {notFound ? t('notFoundTitle') : restricted ? t('restrictedTitle') : t('errorTitle')}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {notFound ? t('notFoundBody') : restricted ? t('restrictedBody') : t('errorBody')}
        </p>

        {notFound || restricted ? null : (
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {tFeed('retry')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProfileHeader profile={profile} />

      <section aria-label={t('postsTitle')} className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{t('postsTitle')}</h2>

        <ProfilePosts userId={userId} />
      </section>
    </div>
  );
}

/**
 * Split out so the posts query only exists once a profile resolved — a hook
 * cannot be called conditionally, and mounting it in the error branches would
 * request posts for a user the backend has already refused to describe.
 */
function ProfilePosts({ userId }: { userId: number }) {
  const t = useTranslations('profile');
  const posts = useAuthorPosts(userId);

  return (
    <PostFeed
      query={posts}
      emptyTitle={t('emptyPostsTitle')}
      emptyBody={t('emptyPostsBody')}
      loadingLabel={t('loadingPosts')}
    />
  );
}
