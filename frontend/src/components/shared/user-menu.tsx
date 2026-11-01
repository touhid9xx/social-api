'use client';

import {
  Flag,
  Images,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMe } from '@/hooks/use-me';
import { useMyRole } from '@/hooks/use-my-role';
import { useSignOut } from '@/hooks/use-sign-out';
import { useSessionStore } from '@/lib/api/tokens';
import { mediaUrl } from '@/lib/api/media';
import { profileGalleryPath, profilePath, ROUTES } from '@/lib/constants';

/**
 * The account dropdown in the top-right corner of the shell.
 *
 * Everything that is *about the person* rather than *about the app* lives here:
 * their profile, their gallery, settings, theme and sign-out. The primary nav
 * keeps only destinations (home, explore, messages, notifications), so the header
 * does not turn into a row of six equally-weighted links where "Settings" and
 * "Home" compete for the same glance.
 *
 * Two correctness details:
 *
 *  - The profile and gallery entries are rendered only once `GET /users/me` has
 *    answered. `/profile` with no id is not a page, and a placeholder href would
 *    be a 404 on the two controls that answer "where is my stuff".
 *  - The trigger's accessible name is a fixed label, not the display name. A
 *    screen reader hears "Account menu, button" every time; hearing a changing
 *    name as the profile loads is noise, and the avatar is decoration on top of
 *    it (`aria-hidden`), since the name is already in the menu label.
 *
 * The theme picker inside the menu is the same `ThemeToggle` used elsewhere: icon
 * buttons only, each with its own accessible name.
 *
 * The staff entry is here, not in the primary nav, and it branches on `role`:
 * `useMyRole()` reads `GET /auth/me` (the only payload that carries a role —
 * `/users/me` returns `ProfileSelf`, which has none). An admin lands on `/admin`,
 * the console root; a moderator lands on `/admin/reports`, because `/admin` and
 * `/admin/audit` are admin-only and would answer 403. Anyone else gets no entry
 * at all. This is a rendering hint, never the access check — the endpoints
 * enforce the role themselves.
 *
 * (প্রোফাইল-সংক্রান্ত সব অপশন — প্রোফাইল, গ্যালারি, সেটিংস, থিম, সাইন আউট — এই
 *  ড্রপডাউনে। প্রধান নেভিতে শুধু গন্তব্য থাকে।)
 */
export function UserMenu() {
  const t = useTranslations('nav.userMenu');
  const tc = useTranslations('common');
  const ts = useTranslations('auth.session');
  const accessToken = useSessionStore((state) => state.accessToken);
  // The shell renders outside `RequireSession`, so on the landing/sign-in screens
  // there is no token and this read would be a guaranteed 401.
  const { data: me } = useMe({ enabled: Boolean(accessToken) });
  const { signOut, pending } = useSignOut();

  const role = useMyRole();
  // `/admin` (flags) and `/admin/audit` are admin-only; the report queue also
  // accepts moderators. So the destination follows the role rather than every
  // staff account being pointed at a page most of them cannot open.
  const isAdmin = role === 'admin';
  const staffHref = isAdmin ? ROUTES.admin : role === 'moderator' ? ROUTES.adminReports : null;

  const displayName = me?.display_name?.trim() ?? '';
  // `ProfileSelf` carries no email, so the display name is all we have to name the
  // account with. A profile without one falls back to a neutral label rather than
  // rendering an empty line.
  const name = displayName || (me ? t('unnamed') : t('signedOut'));
  const initials = initialsOf(displayName);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('label')}
        className="rounded-full outline-hidden transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar aria-hidden="true" size="default">
          {me?.avatar_url ? <AvatarImage src={mediaUrl(me.avatar_url)} alt="" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {me ? t('signedInAs') : t('signedOutHelp')}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          {me ? (
            <DropdownMenuItem asChild>
              <Link href={profilePath(me.user_id)}>
                <User aria-hidden="true" />
                {t('profile')}
              </Link>
            </DropdownMenuItem>
          ) : null}

          {me ? (
            <DropdownMenuItem asChild>
              <Link href={profileGalleryPath(me.user_id)}>
                <Images aria-hidden="true" />
                {t('gallery')}
              </Link>
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem asChild>
            <Link href={ROUTES.settings}>
              <SettingsIcon aria-hidden="true" />
              {t('settings')}
            </Link>
          </DropdownMenuItem>

          {/* Rendered only for staff, and only once `/auth/me` has answered — the
              role is not known before that, and guessing would put a link in
              front of accounts that cannot use it. */}
          {staffHref ? (
            <DropdownMenuItem asChild>
              <Link href={staffHref}>
                {isAdmin ? <ShieldCheck aria-hidden="true" /> : <Flag aria-hidden="true" />}
                {isAdmin ? t('adminConsole') : t('moderationQueue')}
              </Link>
            </DropdownMenuItem>
          ) : null}

          {/* The dashboard is a second admin-only destination next to the console
              root, not a replacement for it: `staffHref` still points moderators
              at the report queue, and pointing them here would be a guaranteed
              403. Same reasoning as above — this is a hint, not the access check. */}
          {isAdmin ? (
            <DropdownMenuItem asChild>
              <Link href={ROUTES.adminDashboard}>
                <LayoutDashboard aria-hidden="true" />
                {t('adminDashboard')}
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* A plain div, not an item: these are three small buttons of their own,
            and a menu item that swallows the click would close the menu on the
            first press instead of letting the user try the other modes. */}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">{tc('theme')}</span>
          <ThemeToggle />
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          // Keep the menu mounted until the redirect lands; closing it first would
          // flash the header while the request is still in flight.
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          disabled={pending}
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <LogOut aria-hidden="true" />
          )}
          {pending ? ts('signingOut') : t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Up to two initials for the fallback avatar.
 *
 * Splits on whitespace and punctuation so "Ada Lovelace" gives "AL" and
 * "ada.lovelace@example.com" gives "AL" rather than "A@".
 */
function initialsOf(source: string): string {
  const words = source
    .split(/[\s._@-]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : '';

  return `${first}${second}`.toUpperCase();
}
