'use client';

import { Bell, Compass, Home, MessageSquare, Settings as SettingsIcon, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useMe } from '@/hooks/use-me';
import { useUnreadCount } from '@/hooks/use-unread-count';
import { ROUTES } from '@/lib/constants';
import { useSessionStore } from '@/lib/api/tokens';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Primary navigation for the signed-in shell.
 *
 * Only the routes that exist are linked. `/search` and the admin pages are still
 * `Placeholder`s, and a nav item that leads to "arrives in a later milestone" is
 * worse than no nav item: it is the one control a user is guaranteed to press.
 * `/messages`, `/settings` and `/profile/[id]` are no longer placeholders, so
 * they belong here — a shipped screen with no way in is the same dead end from
 * the user's side.
 *
 * Three details that are load-bearing:
 *  - `aria-current="page"` on the active link, not just a colour, so the current
 *    screen is announced rather than merely visible;
 *  - the unread badge is `aria-hidden` and its meaning lives in the link's
 *    `aria-label`, because "3" read aloud between "Notifications" and "link"
 *    is noise unless you already know what it counts;
 *  - the badge and the profile link are both gated on an access token inside
 *    their hooks, since the nav renders outside `RequireSession`.
 */
const LINKS = [
  { href: ROUTES.home, key: 'home', Icon: Home },
  { href: ROUTES.explore, key: 'explore', Icon: Compass },
  { href: ROUTES.messages, key: 'messages', Icon: MessageSquare },
  { href: ROUTES.notifications, key: 'notifications', Icon: Bell },
  { href: ROUTES.settings, key: 'settings', Icon: SettingsIcon },
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
  const accessToken = useSessionStore((state) => state.accessToken);
  const { data: unread } = useUnreadCount();
  // `GET /users/me` is the only way to know the caller's own id — `ProfilePublic`
  // carries no "is this me" flag and the session store holds tokens, not a user.
  const { data: me } = useMe({ enabled: Boolean(accessToken) });

  const unreadCount = unread?.unread ?? 0;
  const profileHref = me ? `${ROUTES.profile}/${String(me.user_id)}` : null;

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

      {/* Rendered only once the caller's id is known: a link to `/profile` alone
          is not a page, and a placeholder href would be a 404 on the one control
          that answers "where is my profile". */}
      {profileHref ? (
        <NavLink
          href={profileHref}
          label={t('profile')}
          isCurrent={isCurrent(profileHref)}
          Icon={User}
        />
      ) : null}
    </nav>
  );
}
