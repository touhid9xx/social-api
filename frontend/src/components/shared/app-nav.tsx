'use client';

import { Bell, Compass, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { useUnreadCount } from '@/hooks/use-unread-count';
import { ROUTES } from '@/lib/constants';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Primary navigation for the signed-in shell.
 *
 * Only the three routes that exist are linked. `/messages`, `/search`,
 * `/settings` and the admin pages are still `Placeholder`s, and a nav item that
 * leads to "arrives in a later milestone" is worse than no nav item: it is the
 * one control a user is guaranteed to press.
 *
 * Three details that are load-bearing:
 *  - `aria-current="page"` on the active link, not just a colour, so the current
 *    screen is announced rather than merely visible;
 *  - the unread badge is `aria-hidden` and its meaning lives in the link's
 *    `aria-label`, because "3" read aloud between "Notifications" and "link"
 *    is noise unless you already know what it counts;
 *  - the badge query is gated on an access token inside `useUnreadCount`, since
 *    the nav renders outside `RequireSession`.
 */
const LINKS = [
  { href: ROUTES.home, key: 'home', Icon: Home },
  { href: ROUTES.explore, key: 'explore', Icon: Compass },
  { href: ROUTES.notifications, key: 'notifications', Icon: Bell },
] as const;

export function AppNav() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const { data: unread } = useUnreadCount();

  const unreadCount = unread?.unread ?? 0;

  return (
    <nav aria-label={t('label')} className="flex items-center gap-1">
      {LINKS.map(({ href, key, Icon }) => {
        // `/posts/101` is not `/home`, so only the exact route (or its
        // sub-paths) counts as current. Prefix matching is what makes a future
        // `/posts/[id]` highlight nothing here, which is correct.
        const isCurrent = pathname === href || pathname.startsWith(`${href}/`);
        const isNotifications = key === 'notifications';
        const showBadge = isNotifications && unreadCount > 0;

        const label = showBadge
          ? `${t(key)} (${t('unreadCount', { count: unreadCount })})`
          : t(key);

        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'relative inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              isCurrent
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">{t(key)}</span>

            {showBadge ? (
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground tabular-nums"
                >
                  {formatCount(unreadCount, locale)}
                </span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
