'use client';

import { Bell, Check, BellOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/hooks/use-notification-actions';
import { useNotifications } from '@/hooks/use-notifications';
import { useInView } from '@/hooks/use-in-view';
import { errorMessageKey } from '@/lib/api';
import { mediaUrl } from '@/lib/api/media';
import { NOTIFICATION_COPY_KEYS, type NotificationView } from '@/lib/api/notifications';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The notification inbox — [contracts/api_reference.md:2011].
 *
 * A notification carries `actor_id`, not an actor object, so the name and
 * avatar come from `useAuthor` exactly like a feed card. The row's sentence is
 * chosen by `type` through a total map: adding a type on the server is a
 * compile error here, never a blank line.
 *
 * Where a row links is deliberately narrow. `target_type` says what was acted
 * on: `post` gives `/posts/{id}` and `user` gives `/profile/{id}` — a follow
 * notification sets `target_id` to the follower, which is a real user id. A
 * `comment` target carries the COMMENT id and the app has no comment route, so
 * linking it would open the wrong post. Those rows render without a link rather
 * than shipping one that resolves to the wrong page.
 */

function targetHref(notification: NotificationView): string | null {
  switch (notification.target_type) {
    case 'post':
      return `${ROUTES.posts}/${String(notification.target_id)}`;
    case 'user':
      return `${ROUTES.profile}/${String(notification.target_id)}`;
    case 'comment':
      // A comment target holds the COMMENT id and there is no comment route;
      // linking it would open a post that may not even exist.
      return null;
  }
}

function NotificationSkeleton() {
  const t = useTranslations('notifications');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationRow({ notification }: { notification: NotificationView }) {
  const t = useTranslations('notifications');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { data: author } = useAuthor(notification.actor_id);
  const markRead = useMarkNotificationRead();
  const remove = useDeleteNotification();

  const name = author?.display_name?.trim() || t('actorFallback', { id: notification.actor_id });
  const initial = name.slice(0, 1).toUpperCase();
  const href = targetHref(notification);
  const unread = !notification.is_read;

  const body = (
    <>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm text-foreground">
          {t(NOTIFICATION_COPY_KEYS[notification.type], { name })}
        </span>

        {notification.preview ? (
          <span className="block truncate text-xs text-muted-foreground">
            {notification.preview}
          </span>
        ) : null}

        <time dateTime={notification.created_at} className="block text-xs text-muted-foreground">
          {formatRelativeTime(notification.created_at, locale)}
        </time>
      </span>

      {unread ? (
        <>
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">{t('unread')}</span>
        </>
      ) : null}
    </>
  );

  function handleMarkRead() {
    markRead.mutate(notification.id, {
      onError: (error) => toast.error(tRoot(errorMessageKey(error))),
    });
  }

  function handleDelete() {
    remove.mutate(notification.id, {
      onError: (error) => toast.error(tRoot(errorMessageKey(error))),
    });
  }

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 transition-colors',
        unread ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <Avatar size="default">
        {author?.avatar_url ? <AvatarImage src={mediaUrl(author.avatar_url)} alt="" /> : null}
        <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
      </Avatar>

      {href ? (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2">{body}</span>
      )}

      <span className="flex shrink-0 items-center gap-1">
        {unread ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('markRead')}
            title={t('markRead')}
            disabled={markRead.isPending}
            onClick={handleMarkRead}
          >
            <Check aria-hidden="true" className="size-4" />
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('deleteLabel')}
          title={t('deleteLabel')}
          disabled={remove.isPending}
          onClick={handleDelete}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </span>
    </li>
  );
}

export function NotificationList() {
  const t = useTranslations('notifications');
  const tRoot = useTranslations();
  const markAll = useMarkAllNotificationsRead();
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
  } = useNotifications();

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const items = data ? data.pages.flatMap((page) => page.items) : [];
  const hasUnread = items.some((item) => !item.is_read);

  function handleMarkAll() {
    markAll.mutate(undefined, {
      onError: (err) => toast.error(tRoot(errorMessageKey(err))),
    });
  }

  if (isPending) return <NotificationSkeleton />;

  // Same rule as the feeds: a failed *next page* also flips `isError`, so the
  // page-level state is only for "nothing loaded at all".
  if (isError && items.length === 0) {
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

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
        <BellOff aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bell aria-hidden="true" className="size-3.5" />
          {t('count', { count: items.length })}
        </p>

        {hasUnread ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAll}
            disabled={markAll.isPending}
            aria-busy={markAll.isPending}
          >
            {markAll.isPending ? t('markingAllRead') : t('markAllRead')}
          </Button>
        ) : null}
      </div>

      <ul className="space-y-3">
        {items.map((notification) => (
          <NotificationRow key={notification.id} notification={notification} />
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
    </div>
  );
}
