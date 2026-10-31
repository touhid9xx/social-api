'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useInView } from '@/hooks/use-in-view';
import { useLikers } from '@/hooks/use-likers';
import type { LikeTargetType, LikeUser } from '@/lib/api/likes';
import { mediaUrl } from '@/lib/api/media';
import { profilePath } from '@/lib/constants';
import { formatCount } from '@/lib/format';

/**
 * "Who liked this" — the read side of a like.
 *
 * The count is the trigger: the heart toggles the like and the number opens the
 * list, which is the interaction every product with a like count already
 * teaches. That is why `LikeButton` renders the count here rather than owning
 * it: one element cannot be both a toggle and a dialog trigger, and nesting a
 * `<button>` inside a `<button>` is invalid HTML.
 *
 * The list is mounted only while the dialog is open (`useLikers` is handed
 * `enabled: open`). Opening is therefore an explicit request — no network traffic
 * for a count nobody asked about, which matters in a feed where every card has
 * one of these.
 *
 * `LikeUser` carries `display_name` and `avatar_url` inline, so a row needs no
 * second read — same reason `FollowList` skips `useAuthor`.
 *
 * Zero likes renders a plain number with no trigger: a dialog that can only say
 * "nobody yet" is a dead end, so the count is inert until there is something
 * behind it.
 */
export function LikersDialog({
  targetType,
  targetId,
  count,
}: {
  targetType: LikeTargetType;
  targetId: number;
  count: number;
}) {
  const t = useTranslations('feed.likers');
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const displayCount = formatCount(count, locale);

  if (count <= 0) {
    return (
      <span aria-hidden="true" className="tabular-nums">
        {displayCount}
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The visible glyph is a bare number, so the accessible name has to
        // carry both the count and what pressing it does.
        aria-label={t('open', { count })}
        className="rounded-full px-1.5 py-0.5 tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {displayCount}
      </button>

      {/* `showCloseButton={false}` on purpose: that X carries a hardcoded
          English "Close" for screen readers, which would be the only untranslated
          string in a two-locale app. The footer button below is translated, and
          Escape still closes the dialog. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { count })}</DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, so closing drops the cache entry's
            subscribers and reopening re-reads a set that changes often. */}
        {open ? <LikersList targetType={targetType} targetId={targetId} /> : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LikersList({ targetType, targetId }: { targetType: LikeTargetType; targetId: number }) {
  const t = useTranslations('feed.likers');
  const {
    data,
    isPending,
    isError,
    isFetching,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useLikers(targetType, targetId);

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  if (isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-2">
        <span className="sr-only">{t('loading')}</span>
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex items-center gap-3 py-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </div>
    );
  }

  const users = data ? flattenLikerPages(data.pages) : [];

  // A failed *next page* also flips `isError`; the page-level state is only for
  // "nothing loaded at all" — same rule as the feeds and `FollowList`.
  if (isError && users.length === 0) {
    return (
      <div role="alert" className="space-y-3 rounded-xl border border-border p-4 text-center">
        <h3 className="text-sm font-semibold text-foreground">{t('errorTitle')}</h3>
        <p className="text-xs text-pretty text-muted-foreground">{t('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="space-y-1 rounded-xl border border-dashed border-border p-6 text-center">
        <h3 className="text-sm font-semibold text-foreground">{t('emptyTitle')}</h3>
        <p className="text-xs text-pretty text-muted-foreground">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="max-h-80 space-y-1 overflow-y-auto">
        {users.map((user) => (
          <li key={user.user_id}>
            <LikerRow user={user} />
          </li>
        ))}
      </ul>

      {hasNextPage ? (
        <div className="space-y-2">
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

          <div className="flex flex-col items-center gap-1">
            <Button
              variant="outline"
              size="sm"
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
        <p className="text-center text-xs text-muted-foreground">{t('endOfList')}</p>
      )}
    </div>
  );
}

function LikerRow({ user }: { user: LikeUser }) {
  const tFeed = useTranslations('feed');

  // Same fallback as every other place a name is rendered: the backend allows a
  // null `display_name`, and "User 24" beats a blank row.
  const name = user.display_name?.trim() || tFeed('authorFallback', { id: user.user_id });
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <Link
      href={profilePath(user.user_id)}
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Avatar size="sm">
        {user.avatar_url ? <AvatarImage src={mediaUrl(user.avatar_url)} alt="" /> : null}
        <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{name}</span>
    </Link>
  );
}

/**
 * Pages in, one flat list out — same guarantee as `flattenFollowPages`.
 *
 * A like set changes while it is being read, so one person can appear on two
 * consecutive pages; duplicates are dropped by `user_id` so React keys stay
 * unique and nobody is listed twice. A like that is *removed* mid-read can also
 * shift the cursor window, which is why the dedupe is by id and not by index.
 */
export function flattenLikerPages(pages: Array<{ items: LikeUser[] }>): LikeUser[] {
  const seen = new Set<number>();
  const users: LikeUser[] = [];

  for (const page of pages) {
    for (const user of page.items) {
      if (seen.has(user.user_id)) continue;
      seen.add(user.user_id);
      users.push(user);
    }
  }

  return users;
}
