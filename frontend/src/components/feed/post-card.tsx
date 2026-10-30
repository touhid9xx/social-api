'use client';

import { Globe, Lock, MessageCircle, Pencil, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/use-author';
import type { FeedPost } from '@/lib/api/feed';
import { ROUTES } from '@/lib/constants';
import { formatCount, formatRelativeTime } from '@/lib/format';

import { LikeButton } from './like-button';

/**
 * One post in the feed.
 *
 * The backend serialises `author_id`, not an author object, so the name and
 * avatar come from `useAuthor` — cached per id, so a page of posts costs one
 * request per distinct author. Until (or unless) that resolves we still render
 * a usable card: a translated "User 42" fallback instead of a blank line.
 *
 * Everything is a link to the post detail route so the card is reachable by
 * keyboard without making the whole article clickable.
 *
 * (author_id ছাড়া backend নাম দেয় না — তাই useAuthor দিয়ে id-ভিত্তিক cache করা হয়।)
 */

const VISIBILITY_ICON = {
  public: Globe,
  followers: Users,
  private: Lock,
} as const;

export function PostCard({ post }: { post: FeedPost }) {
  const t = useTranslations('feed');
  const locale = useLocale();
  const { data: author } = useAuthor(post.author_id);

  const displayName = author?.display_name?.trim() || t('authorFallback', { id: post.author_id });
  const initial = displayName.slice(0, 1).toUpperCase();
  const VisibilityIcon = VISIBILITY_ICON[post.visibility];
  const visibilityLabel = t(`visibility.${post.visibility}`);

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors focus-within:border-ring sm:p-5">
      <header className="flex items-start gap-3">
        <Avatar size="default">
          {author?.avatar_url ? <AvatarImage src={author.avatar_url} alt="" /> : null}
          <AvatarFallback aria-hidden="true">{initial}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Not a link yet: `/profile/[username]` is keyed by username and
                the contract exposes no username, only `user_id`. Author links
                land with the profile milestone (F11) rather than shipping a
                link that resolves to the wrong URL. */}
            <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>

            <span className="text-xs text-muted-foreground">·</span>

            <time dateTime={post.created_at} className="text-xs text-muted-foreground">
              {formatRelativeTime(post.created_at, locale)}
            </time>

            {post.is_edited ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
                <Pencil aria-hidden="true" className="size-3" />
                {t('edited')}
              </span>
            ) : null}

            <span
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={t('visibilityLabel', { visibility: visibilityLabel })}
            >
              <VisibilityIcon aria-hidden="true" className="size-3.5" />
              {/* Icon alone is not a label: screen readers get the word too. */}
              <span className="sr-only">
                {t('visibilityLabel', { visibility: visibilityLabel })}
              </span>
            </span>
          </div>
        </div>
      </header>

      <p className="mt-3 text-[0.95rem] leading-relaxed text-pretty break-words whitespace-pre-line text-card-foreground">
        {post.body}
      </p>

      <footer className="mt-4 flex items-center gap-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle aria-hidden="true" className="size-3.5" />
          <span>{formatCount(post.comment_count, locale)}</span>
          <span className="sr-only">{t('commentCount', { count: post.comment_count })}</span>
        </span>

        {/* The like button owns its own count and `aria-pressed` state; the card
            merely supplies the values so the optimistic cache remains the one
            source of truth for both. */}
        <LikeButton targetId={post.id} isLiked={post.is_liked_by_me} count={post.like_count} />

        <Link
          href={`${ROUTES.posts}/${String(post.id)}`}
          className="ml-auto text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('openPost')}
        </Link>
      </footer>
    </article>
  );
}
