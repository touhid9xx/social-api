'use client';

import { ShieldOff, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminUsers } from '@/hooks/use-admin-users';
import { useInView } from '@/hooks/use-in-view';
import { isAppApiError } from '@/lib/api';
import { mediaUrl } from '@/lib/api/media';
import type { AdminUserView } from '@/lib/api/users';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

/**
 * The staff-only user directory — `GET /api/v1/users`.
 *
 * `AdminUserView` already carries `display_name` and `avatar_url`, so a row is
 * one request's worth of data and must not fan out to `/users/{id}` per row —
 * the same rule `FollowList` documents, and the reason this component does not
 * touch `useAuthor`.
 *
 * A `403` is rendered as "admins only", never as an empty directory: "nobody has
 * signed up" and "you are not allowed to see who did" are different facts.
 *
 * The rows are read-only on purpose. Nothing in the contract lets an admin
 * change another account's role or active flag, so the console reports state
 * instead of offering controls that would have no endpoint behind them.
 */
export function UserList() {
  const t = useTranslations('admin.users');
  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useAdminUsers();

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const users = data ? flattenUserPages(data.pages) : [];

  if (isError && isAppApiError(error) && error.status === 403) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6 text-center">
        <ShieldOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('adminOnlyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('adminOnlyBody')}</p>
      </div>
    );
  }

  if (isPending) return <UserSkeleton />;

  // A failed *next page* also flips `isError`; the page-level state is only for
  // "nothing loaded at all", same rule as the feeds and the audit log.
  if (isError && users.length === 0) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h2 className="text-base font-semibold text-foreground">{t('errorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
        <p className="sr-only">{error instanceof Error ? error.message : ''}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('count', { count: users.length })}</p>

      {users.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <Users aria-hidden="true" className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </ul>
      )}

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
        <p className="py-2 text-center text-xs text-muted-foreground">{t('endOfList')}</p>
      )}
    </div>
  );
}

function UserSkeleton() {
  const t = useTranslations('admin.users');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function UserRow({ user }: { user: AdminUserView }) {
  const t = useTranslations('admin.users');
  const locale = useLocale();

  const name = user.display_name?.trim() || t('nameFallback', { id: user.id });
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <li>
      <Link
        href={`${ROUTES.profile}/${String(user.id)}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar size="default">
          {user.avatar_url ? <AvatarImage src={mediaUrl(user.avatar_url)} alt="" /> : null}
          <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
        </Avatar>

        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{name}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-micro font-medium text-muted-foreground">
              {t(`role.${user.role}`)}
            </span>
          </span>

          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{t(user.is_verified ? 'verified' : 'unverified')}</span>
            <span aria-hidden="true">·</span>
            <span>{t(user.is_active ? 'active' : 'deactivated')}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={user.created_at}>
              {t('joined', { time: formatRelativeTime(user.created_at, locale) })}
            </time>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Pages in, one flat list out — same guarantee as `flattenFollowPages`.
 *
 * The directory is keyset-paginated on `(created_at, id)`, so it is stable while
 * being read, but a signup between two page loads still shifts the window. The
 * list drops repeated ids so React keys stay unique and nobody is listed twice.
 */
function flattenUserPages(pages: Array<{ items: AdminUserView[] }>): AdminUserView[] {
  const seen = new Set<number>();
  const users: AdminUserView[] = [];

  for (const page of pages) {
    for (const user of page.items) {
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      users.push(user);
    }
  }

  return users;
}
