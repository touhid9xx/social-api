'use client';

import { Images, Link2, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { useFollowCounts } from '@/hooks/use-follow-counts';
import { useMe } from '@/hooks/use-me';
import { mediaUrl } from '@/lib/api/media';
import type { PublicProfile } from '@/lib/api/users';
import { profileGalleryPath, ROUTES } from '@/lib/constants';
import { formatCount } from '@/lib/format';

import { FollowButton } from './follow-button';

/**
 * The top of a profile: who this is, what they say about themselves, and how to
 * follow them.
 *
 * The profile object is passed in rather than fetched here, because the page
 * above has to fetch it anyway to tell 404 from a slow load — two `useAuthor`
 * calls would share one cache entry, but the page still needs the value, so one
 * owner is simpler than two observers.
 *
 * The counts are LINKED even when they are zero: `/followers` is a route, and
 * "0 followers" is a true page rather than a disabled label. They come from
 * `useFollowCounts`, which is a different endpoint from the status query on
 * purpose (public and slow-changing, versus private and instant) — see
 * `use-follow-counts.ts`.
 *
 * `website` is rendered as a link only when it parses as http(s). The field is
 * free text on the server, so `javascript:` and friends must never reach an
 * `href`.
 */
export function ProfileHeader({ profile }: { profile: PublicProfile }) {
  const t = useTranslations('profile');
  const tFeed = useTranslations('feed');
  const locale = useLocale();
  const { data: counts } = useFollowCounts(profile.user_id);
  // Shares one cache entry with `FollowButton` (same `useMe` key), so asking
  // "is this me?" costs no extra request on a profile that already asks it.
  const { data: me } = useMe();

  const isSelf = me?.user_id === profile.user_id;
  const displayName =
    profile.display_name?.trim() || tFeed('authorFallback', { id: profile.user_id });
  const initial = displayName.slice(0, 1).toUpperCase();
  const website = safeWebsite(profile.website);

  const followersHref = `${ROUTES.profile}/${String(profile.user_id)}/followers`;
  const followingHref = `${ROUTES.profile}/${String(profile.user_id)}/following`;

  return (
    <header className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <Avatar size="lg">
          {profile.avatar_url ? <AvatarImage src={mediaUrl(profile.avatar_url)} alt="" /> : null}
          <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {displayName}
          </h1>

          {profile.visibility === 'private' ? (
            <p className="text-xs text-muted-foreground">{t('privateBadge')}</p>
          ) : null}

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <div className="inline-flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{t('followersLabel')}</dt>
              <dd>
                <Link
                  href={followersHref}
                  className="font-semibold text-foreground tabular-nums underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {formatCount(counts?.followers ?? 0, locale)}
                </Link>
              </dd>
            </div>

            <div className="inline-flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{t('followingLabel')}</dt>
              <dd>
                <Link
                  href={followingHref}
                  className="font-semibold text-foreground tabular-nums underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {formatCount(counts?.following ?? 0, locale)}
                </Link>
              </dd>
            </div>
          </dl>

          {/* Galleries are derived from posts, so there is no count to show and
              no reason to hide the link on an empty one: the page explains
              "nothing here yet", which is more useful than a missing door. */}
          <Link
            href={profileGalleryPath(profile.user_id)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Images aria-hidden="true" className="size-3.5" />
            {t('galleryLink')}
          </Link>
        </div>

        {/* Your own profile has no follow control (`CANNOT_FOLLOW_SELF`), so the
            slot carries the one action that does apply here. */}
        {isSelf ? (
          <Link
            href={ROUTES.settings}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('editProfile')}
          </Link>
        ) : (
          <FollowButton userId={profile.user_id} name={displayName} />
        )}
      </div>

      {profile.bio?.trim() ? (
        <p className="text-sm leading-relaxed text-pretty break-words whitespace-pre-line text-card-foreground">
          {profile.bio}
        </p>
      ) : null}

      {profile.location?.trim() || website ? (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {profile.location?.trim() ? (
            <li className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-3.5" />
              <span>{profile.location}</span>
            </li>
          ) : null}

          {website ? (
            <li className="inline-flex items-center gap-1.5">
              <Link2 aria-hidden="true" className="size-3.5" />
              <a
                href={website.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {website.label}
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}
    </header>
  );
}

/**
 * `website` is free text, so it is only ever an `href` when it is a real http(s)
 * URL. Anything else (`javascript:`, `data:`, a bare word) is dropped instead of
 * sanitised — there is nothing useful to render from it.
 */
function safeWebsite(raw: string | null | undefined): { href: string; label: string } | null {
  const value = raw?.trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  return {
    href: url.toString(),
    label: url.hostname.replace(/^www\./, '') + url.pathname.replace(/\/$/, ''),
  };
}
