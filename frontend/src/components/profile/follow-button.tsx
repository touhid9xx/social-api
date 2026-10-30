'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useFollowStatus } from '@/hooks/use-follow-status';
import { useMe } from '@/hooks/use-me';
import { useToggleFollow } from '@/hooks/use-toggle-follow';
import { errorMessageKey } from '@/lib/api';

/**
 * Follow / unfollow control for one profile.
 *
 * Three cases decide whether this renders at all, and all three are feature
 * decisions rather than cosmetics:
 *
 *  1. **Own profile** — the backend answers `CANNOT_FOLLOW_SELF`, so rendering
 *     the button would be rendering a guaranteed error. `useMe()` is the only
 *     way to know: the public profile carries no "is this me" flag.
 *  2. **The viewer blocked them** — following would silently unblock, which is
 *     not what the click means. Unblocking belongs to the block list.
 *  3. **They blocked the viewer** — every follow attempt is rejected, so the
 *     control becomes a short explanation instead of a button that cannot work.
 *
 * Until both queries settle, nothing is rendered. Showing "Follow" while the
 * status request is in flight would flash the wrong state on every page load and
 * invite a click that races the answer.
 *
 * The mutation takes the DESIRED state (`!following`), so a double-tap cannot
 * fire two follows — see `useToggleFollow`.
 */
export function FollowButton({ userId, name }: { userId: number; name: string }) {
  const t = useTranslations('profile');
  const tRoot = useTranslations();
  const status = useFollowStatus(userId);
  const me = useMe();
  const toggle = useToggleFollow();

  if (status.isPending || me.isPending) return null;

  if (me.data?.user_id === userId) return null;
  if (status.data?.is_blocked_by_me) return null;

  if (status.data?.has_blocked_me) {
    return <p className="text-sm text-muted-foreground">{t('blockedByThem')}</p>;
  }

  const following = status.data?.is_following ?? false;

  function handleClick() {
    toggle.mutate(
      { userId, following: !following },
      {
        onError: (error) => {
          toast.error(tRoot(errorMessageKey(error)));
        },
      },
    );
  }

  return (
    <Button
      type="button"
      variant={following ? 'outline' : 'default'}
      size="sm"
      onClick={handleClick}
      disabled={toggle.isPending}
      aria-busy={toggle.isPending}
      aria-pressed={following}
      aria-label={following ? t('unfollowAction', { name }) : t('followAction', { name })}
    >
      {following ? t('following') : t('follow')}
    </Button>
  );
}
