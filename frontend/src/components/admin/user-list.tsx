'use client';

import {
  BadgeCheck,
  BadgeX,
  Loader2,
  Lock,
  MoreHorizontal,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActivateAdminUser,
  useDeleteAdminUser,
  useUpdateAdminUser,
} from '@/hooks/use-admin-user-actions';
import { useAdminUsers } from '@/hooks/use-admin-users';
import { useInView } from '@/hooks/use-in-view';
import { useMe } from '@/hooks/use-me';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import { mediaUrl } from '@/lib/api/media';
import type { AdminUserUpdate, AdminUserView } from '@/lib/api/users';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

/**
 * The staff-only user directory — `GET /api/v1/users`, plus the three admin
 * account writes (`PATCH`, `POST /activate`, `DELETE` on `/users/{id}`).
 *
 * `AdminUserView` already carries `display_name`, `avatar_url` and
 * `email_masked`, so a row is one request's worth of data and must not fan out
 * to `/users/{id}` per row — the same rule `FollowList` documents, and the
 * reason this component does not touch `useAuthor`. (`useMe` is the one profile
 * read here, and it is a single shared cache entry for the whole session, not
 * per row.)
 *
 * A `403` is rendered as "admins only", never as an empty directory: "nobody has
 * signed up" and "you are not allowed to see who did" are different facts.
 *
 * ## Why the rows carry controls now
 *
 * The three writes answer with the full re-read `AdminUserView`, so the server is
 * the authority and every mutation invalidates the directory rather than patching
 * a row optimistically — a refusal (`CANNOT_MODIFY_SELF`, `LAST_ADMIN_PROTECTED`)
 * has its own copy and must not be pre-empted by a screen that already moved.
 *
 * Two of those refusals are also *visible* rules, not just server answers:
 *
 *  1. **Your own row has no menu.** Deactivating or demoting yourself is one-way
 *     from your side — you would lose the console needed to undo it — so the row
 *     renders a muted lock labelled with the reason instead of controls that only
 *     exist to be refused.
 *  2. **Activate is a distinct action, not `is_active: true`.** It clears the
 *     sign-in block *and* marks the email verified in one call — the manual
 *     stand-in for the emailed link on a deployment with no mail server. Only the
 *     plain deactivation is a `PATCH`.
 *
 * The action menu is a sibling of the `<Link>`, never a child: the whole row is
 * one anchor, so a button inside it would navigate on click.
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
  // One shared `GET /users/me` for the whole list, so each row can answer "is
  // this me?" without its own request. Before it resolves no row looks like self
  // (`me?.user_id` is undefined) — that briefly shows the menu on your own row,
  // which is why the backend also refuses the write.
  const { data: me } = useMe();

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
            <UserRow key={user.id} user={user} isSelf={me?.user_id === user.id} />
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

function UserRow({ user, isSelf }: { user: AdminUserView; isSelf: boolean }) {
  const t = useTranslations('admin.users');
  const tRoot = useTranslations();
  const locale = useLocale();

  const update = useUpdateAdminUser();
  const activate = useActivateAdminUser();
  const remove = useDeleteAdminUser();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const name = user.display_name?.trim() || t('nameFallback', { id: user.id });
  const initial = name.slice(0, 1).toUpperCase();
  const pending = update.isPending || activate.isPending || remove.isPending;

  // One refusal path for all three writes: the code decides the copy, so a
  // `CANNOT_MODIFY_SELF` and a `LAST_ADMIN_PROTECTED` each explain themselves
  // instead of collapsing into a generic "something went wrong".
  function reportError(error: unknown) {
    toast.error(tRoot(errorMessageKey(error)));
  }

  function setActive(isActive: boolean) {
    const changes: AdminUserUpdate = { is_active: isActive };
    update.mutate(
      { userId: user.id, changes },
      {
        onSuccess: () => toast.success(t('actions.deactivated', { name })),
        onError: reportError,
      },
    );
  }

  // The named endpoint, not `{ is_active: true }`: it also clears the
  // "unverified" flag, which is the whole point for a stuck signup.
  function runActivate() {
    activate.mutate(user.id, {
      onSuccess: () => toast.success(t('actions.activated', { name })),
      onError: reportError,
    });
  }

  function setVerified(isVerified: boolean) {
    const changes: AdminUserUpdate = { is_verified: isVerified };
    update.mutate(
      { userId: user.id, changes },
      {
        onSuccess: () =>
          toast.success(t(isVerified ? 'actions.verified' : 'actions.unverified', { name })),
        onError: reportError,
      },
    );
  }

  function changeRole(next: string) {
    if (!isRole(next) || next === user.role) return;
    update.mutate(
      { userId: user.id, changes: { role: next } },
      {
        onSuccess: () => toast.success(t('actions.roleChanged', { name, role: t(`role.${next}`) })),
        onError: reportError,
      },
    );
  }

  function confirmDelete() {
    remove.mutate(user.id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(t('actions.deleted', { name }));
      },
      onError: (error) => {
        setConfirmOpen(false);
        reportError(error);
      },
    });
  }

  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/40">
      <Link
        href={`${ROUTES.profile}/${String(user.id)}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
            {/* The only identity a fresh account has. Registration collects just
                email + password, so `display_name` is null and `User {id}` tells
                an admin nothing about *who* they are verifying. The mask is
                built server-side (`s***@gmail.com`) — recognisable, and the
                domain keeps two same-initial accounts apart. */}
            <span className="truncate font-mono text-micro">{user.email_masked}</span>
            <span aria-hidden="true">·</span>
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

      {isSelf ? (
        // No controls on your own account — the rule the backend enforces, shown
        // rather than merely refused. `aria-label` carries the reason.
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled
          aria-label={t('actions.selfHint')}
          title={t('actions.selfHint')}
          className="shrink-0"
        >
          <Lock aria-hidden="true" />
        </Button>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={pending}
                aria-label={t('actions.menu', { name })}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{name}</DropdownMenuLabel>

              <DropdownMenuItem
                onSelect={() => {
                  if (user.is_active) setActive(false);
                  else runActivate();
                }}
              >
                {user.is_active ? <UserX aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
                <MenuCopy
                  label={t(user.is_active ? 'actions.deactivate' : 'actions.activate')}
                  hint={t(user.is_active ? 'actions.deactivateHint' : 'actions.activateHint')}
                />
              </DropdownMenuItem>

              <DropdownMenuItem onSelect={() => setVerified(!user.is_verified)}>
                {user.is_verified ? (
                  <BadgeX aria-hidden="true" />
                ) : (
                  <BadgeCheck aria-hidden="true" />
                )}
                <MenuCopy
                  label={t(user.is_verified ? 'actions.unverify' : 'actions.verify')}
                  hint={t(user.is_verified ? 'actions.unverifyHint' : 'actions.verifyHint')}
                />
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>{t('actions.roleLabel')}</DropdownMenuLabel>
              <p className="px-2 pb-1 text-micro text-pretty text-muted-foreground">
                {t('actions.roleHint')}
              </p>
              <DropdownMenuRadioGroup value={user.role} onValueChange={changeRole}>
                {ROLE_OPTIONS.map((role) => (
                  <DropdownMenuRadioItem key={role} value={role}>
                    {t(`role.${role}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                // `preventDefault` keeps the menu's own close from fighting the
                // dialog's focus trap; the dialog lives outside the menu so it
                // survives the menu unmounting.
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                <MenuCopy label={t('actions.delete')} hint={t('actions.deleteHint')} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('actions.confirmDeleteTitle')}</DialogTitle>
                <DialogDescription>{t('actions.confirmDeleteBody', { name })}</DialogDescription>
              </DialogHeader>

              <DialogFooter>
                {/* A translated close, not the footer's hardcoded English
                    `showCloseButton` — same reason as the privacy panel. */}
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t('actions.cancel')}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={confirmDelete}
                >
                  {remove.isPending ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {remove.isPending ? t('actions.working') : t('actions.confirmDeleteConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </li>
  );
}

/** A menu row with its consequence spelled out underneath. */
function MenuCopy({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className="text-micro text-pretty text-muted-foreground">{hint}</span>
    </span>
  );
}

/** The backend `UserRoleLiteral`, in the order the console lists them. */
const ROLE_OPTIONS: ReadonlyArray<AdminUserView['role']> = ['user', 'moderator', 'admin'];

function isRole(value: string): value is AdminUserView['role'] {
  return (ROLE_OPTIONS as readonly string[]).includes(value);
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
