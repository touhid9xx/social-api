'use client';

import { Heart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useToggleLike } from '@/hooks/use-toggle-like';
import { errorMessageKey } from '@/lib/api';
import type { LikeTargetType } from '@/lib/api/likes';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The like control, for a feed card and for a comment.
 *
 * `aria-pressed` carries the state and the visible number carries the count, so
 * the accessible name reads "12 Unlike" — a stateful button, not a mystery
 * icon. The `sr-only` word is the ACTION (`Like` / `Unlike`), because turning
 * the state into the label would announce "Liked, button, not pressed".
 *
 * The count comes from props (the entity being rendered), not from a local
 * copy: the optimistic write lands in the query cache, so the owner re-renders
 * from one source of truth and the number can never drift from
 * `is_liked_by_me`.
 *
 * `targetType` exists because the backend has a single endpoint for both
 * targets; the hook uses it to decide which caches to patch.
 *
 * A failed request rolls the cache back in `useToggleLike` and surfaces one
 * toast here — an inline error per card would be noise the user cannot act on.
 */
export function LikeButton({
  targetId,
  targetType = 'post',
  isLiked,
  count,
}: {
  targetId: number;
  targetType?: LikeTargetType;
  isLiked: boolean;
  count: number;
}) {
  const t = useTranslations('feed');
  const tRoot = useTranslations();
  const locale = useLocale();
  const like = useToggleLike();

  const displayCount = formatCount(count, locale);
  // Named explicitly rather than derived from the children: the count and the
  // sr-only word are separate elements, and the accessible-name algorithm
  // concatenates them without inserting a separator, so the derived name was
  // "12Like" — one word, announced as one word.
  const accessibleName = `${displayCount} ${isLiked ? t('unlikeAction') : t('likeAction')}`;

  function handleClick() {
    like.mutate(
      { targetType, targetId, liked: !isLiked },
      {
        onError: (error) => {
          toast.error(tRoot(errorMessageKey(error)));
        },
      },
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={accessibleName}
      aria-pressed={isLiked}
      disabled={like.isPending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        isLiked
          ? 'text-destructive'
          : 'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent',
      )}
    >
      <Heart aria-hidden="true" className="size-3.5" fill={isLiked ? 'currentColor' : 'none'} />
      {/* Decorative here: `aria-label` already carries both the count and the
          action word, so exposing the number again would announce it twice. */}
      <span aria-hidden="true" className="tabular-nums">
        {displayCount}
      </span>
    </button>
  );
}
