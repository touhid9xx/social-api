'use client';

import { Images, Loader2, LogOut, Settings as SettingsIcon, User } from 'lucide-react';
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
