'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type FollowListKind, useFollowList } from '@/hooks/use-follow-list';
import { useInView } from '@/hooks/use-in-view';
import { isAppApiError } from '@/lib/api';
import type { FollowUser } from '@/lib/api/follows';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

/**
 * One end of a follow graph: `/profile/[id]/followers` or `/following`.
 *
 * Both endpoints serialise the same `FollowListPage`, so this is one component
 * with the `kind` choosing the key and the fetcher — see `use-follow-list.ts`.
 *
 * Unlike a feed card, a row needs no second request: `FollowUserView` already
 * carries `display_name` and `avatar_url`. That is why this list does not use
 * `useAuthor` — asking for a profile it was just handed would double the
 * requests for no extra information.
 *
 * Who may read the list is the backend's decision. A private or unfollowed
 * account answers 403 (`PROFILE_NOT_VISIBLE`), which is rendered as "this list
 * is private" rather than as an empty list: "nobody follows them" and "you
 * cannot see this" are different facts and must not look the same.
 *
 * (403 মানে লিস্ট দেখা যাবে না — খালি লিস্ট নয়।)
 */
export function FollowList({ userId, kind }: { userId: number; kind: FollowListKind }) {
  const t = useTranslations('profile.followList');
  const {
    data,
    isPending,
    isError,
    error,
    isFetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useFollowList(userId, kind);

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const title = kind === 'followers' ? t('followersTitle') : t('followingTitle');

  if (isPending) {
    return (
      <section aria-label={title} aria-busy="true" aria-live="polite" className="space-y-3">
        <span className="sr-only">{t('loading')}</span>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
          >
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  const users = data ? flattenFollowPages(data.pages) : [];

  // A failed *next page* also flips `isError`, so the page-level state is only
  // for "nothing loaded at all" — same rule as the feeds.
  if (isError && users.length === 0) {
    const restricted = isAppApiError(error) && error.status === 403;

    return (
      <section aria-label={title} className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>

        <div
          role="alert"
          className="space-y-3 rounded-xl border border-border bg-card p-6 text-center"
        >
          <h2 className="text-base font-semibold text-foreground">
            {restricted ? t('restrictedTitle') : t('errorTitle')}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {restricted ? t('restrictedBody') : t('errorBody')}
          </p>

          {restricted ? null : (
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              {t('retry')}
            </Button>
          )}
        </div>

        <BackToProfile userId={userId} />
      </section>
    );
  }

  if (users.length === 0) {
    return (
      <section aria-label={title} className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>

        <div className="space-y-2 rounded-xl border border-dashed border-border p-8 text-center">
          <h2 className="text-base font-semibold text-foreground">
            {kind === 'followers' ? t('emptyFollowersTitle') : t('emptyFollowingTitle')}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
        </div>

        <BackToProfile userId={userId} />
      </section>
    );
  }

  return (
    <section aria-label={title} className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>

      <ul className="space-y-3">
        {users.map((user) => (
          <li key={user.user_id}>
            <FollowRow user={user} />
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
        <p className="py-4 text-center text-xs text-muted-foreground">{t('endOfList')}</p>
      )}

      <BackToProfile userId={userId} />
    </section>
  );
}

function FollowRow({ user }: { user: FollowUser }) {
  const t = useTranslations('profile.followList');
  const tFeed = useTranslations('feed');
  const locale = useLocale();

  const name = user.display_name?.trim() || tFeed('authorFallback', { id: user.user_id });
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <Link
      href={`${ROUTES.profile}/${String(user.user_id)}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Avatar size="default">
        {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
        <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
        <time dateTime={user.followed_at} className="block text-xs text-muted-foreground">
          {t('followedAt', { time: formatRelativeTime(user.followed_at, locale) })}
        </time>
      </span>
    </Link>
  );
}

function BackToProfile({ userId }: { userId: number }) {
  const t = useTranslations('profile.followList');

  return (
    <Link
      href={`${ROUTES.profile}/${String(userId)}`}
      className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {t('backToProfile')}
    </Link>
  );
}

/**
 * Pages in, one flat list out — same guarantee as `flattenFeedPages`.
 *
 * A follow graph changes while it is being read, so a person can appear on two
 * consecutive pages; duplicates are dropped by `user_id` so React keys stay
 * unique and nobody is listed twice.
 */
function flattenFollowPages(pages: Array<{ items: FollowUser[] }>): FollowUser[] {
  const seen = new Set<number>();
  const users: FollowUser[] = [];

  for (const page of pages) {
    for (const user of page.items) {
      if (seen.has(user.user_id)) continue;
      seen.add(user.user_id);
      users.push(user);
    }
  }

  return users;
}
