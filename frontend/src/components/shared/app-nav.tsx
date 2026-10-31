'use client';

import { Bell, Compass, Home, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useUnreadCount } from '@/hooks/use-unread-count';
import { ROUTES } from '@/lib/constants';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Primary navigation for the signed-in shell.
 *
 * Destination links only: the four places in the app a user navigates *to*.
 * Everything that is about the signed-in person — their profile, their gallery,
 * settings, theme, sign-out — lives in `UserMenu` at the far right. Keeping
 * them here made six equally weighted links compete for one glance and left the
 * header with two different "you" entry points.
 *
 * Only the routes that exist are linked. `/search` is still a `Placeholder`, so a
 * link to it would be the one control a user is guaranteed to press. The staff
 * console is deliberately absent too, but no longer because it cannot be gated:
 * `useMyRole()` reads the role from `GET /auth/me`, so it could be. It lives in
 * `UserMenu` instead — a staff console is an account capability rather than a
 * social destination, and the four links here are the four places a user
 * browses to. The endpoints behind the console enforce the role regardless of
 * what any menu renders.
 *
 * Two details that are load-bearing:
 *  - `aria-current="page"` on the active link, not just a colour, so the current
 *    screen is announced rather than merely visible;
 *  - the unread badge is `aria-hidden` and its meaning lives in the link's
 *    `aria-label`, because "3" read aloud between "Notifications" and "link"
 *    is noise unless you already know what it counts.
 */
const LINKS = [
  { href: ROUTES.home, key: 'home', Icon: Home },
  { href: ROUTES.explore, key: 'explore', Icon: Compass },
  { href: ROUTES.messages, key: 'messages', Icon: MessageSquare },
  { href: ROUTES.notifications, key: 'notifications', Icon: Bell },
] as const;

type NavLinkProps = {
  href: string;
  label: string;
  isCurrent: boolean;
  Icon: typeof Home;
  badge?: ReactNode;
};

function NavLink({ href, label, isCurrent, Icon, badge }: NavLinkProps) {
  return (
    <Link
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
      <span className="hidden sm:inline">{label}</span>

      {badge}
    </Link>
  );
}

export function AppNav() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const pathname = usePathname();
  const { data: unread } = useUnreadCount();

  const unreadCount = unread?.unread ?? 0;

  // `/posts/101` is not `/home`, so only the exact route (or its sub-paths)
  // counts as current. Prefix matching is what makes `/posts/[id]` highlight
  // nothing here, which is correct.
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label={t('label')} className="flex items-center gap-1">
      {LINKS.map(({ href, key, Icon }) => {
        const showBadge = key === 'notifications' && unreadCount > 0;

        const label = showBadge
          ? `${t(key)} (${t('unreadCount', { count: unreadCount })})`
          : t(key);

        return (
          <NavLink
            key={href}
            href={href}
            label={label}
            isCurrent={isCurrent(href)}
            Icon={Icon}
            badge={
              showBadge ? (
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground tabular-nums"
                >
                  {formatCount(unreadCount, locale)}
                </span>
              ) : null
            }
          />
        );
      })}
    </nav>
  );
}
