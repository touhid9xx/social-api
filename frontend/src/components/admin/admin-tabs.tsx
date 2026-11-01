'use client';

import { Flag, LayoutDashboard, ScrollText, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useMyRole } from '@/hooks/use-my-role';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Section navigation across the staff area.
 *
 * The four screens already existed as independent routes with no shared
 * affordance — the only way from the dashboard to the audit trail was the
 * account menu, one destination at a time. This renders them as one section.
 *
 * **Links, not Radix `Tabs`.** These are real routes, so they must stay
 * deeplinkable, middle-clickable, openable in a new tab and reachable with the
 * browser's back button. `Tabs` would keep the URL fixed and swap panels,
 * which breaks all four. `SettingsTabs` can use `Tabs` because its panels have
 * no routes of their own; here the URL *is* the state.
 *
 * The role gate mirrors `UserMenu`: `useMyRole()` reads `GET /auth/me`, the only
 * payload carrying a role. A moderator gets the report queue alone — the other
 * three endpoints answer `require_roles(ADMIN)` and would be a guaranteed 403.
 * This is a rendering hint, never the access check; every endpoint enforces the
 * role itself.
 *
 * `/admin` (the feature-flag console) is intentionally absent. It is the staff
 * root the account menu points admins at, not one of the four dashboards, and
 * folding it in would put a debugging tool on par with the operational screens.
 */
const LINKS = [
  { href: ROUTES.adminDashboard, key: 'dashboard', Icon: LayoutDashboard, adminOnly: true },
  { href: ROUTES.adminUsers, key: 'users', Icon: Users, adminOnly: true },
  { href: ROUTES.adminReports, key: 'reports', Icon: Flag, adminOnly: false },
  { href: ROUTES.adminAudit, key: 'audit', Icon: ScrollText, adminOnly: true },
] as const;

export function AdminTabs() {
  const t = useTranslations('admin.tabs');
  const pathname = usePathname();
  const role = useMyRole();

  // Nothing renders until `/auth/me` answers, and nothing renders for a
  // non-staff account either. Both cases would otherwise flash controls that
  // vanish: unknown role first (the query is in flight), then `'user'`, who has
  // no staff destination at all. Same test `UserMenu` applies to its staff entry.
  if (role !== 'admin' && role !== 'moderator') return null;

  const isAdmin = role === 'admin';
  const links = LINKS.filter((link) => !link.adminOnly || isAdmin);

  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label={t('label')}
      className="mb-6 flex flex-wrap items-center gap-1 border-b border-border pb-2"
    >
      {links.map(({ href, key, Icon }) => {
        const current = isCurrent(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              current
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
