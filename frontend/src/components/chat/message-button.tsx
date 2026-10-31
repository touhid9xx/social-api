'use client';

import { MessageSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useStartDirectRoom } from '@/hooks/use-chat-actions';
import { useFollowStatus } from '@/hooks/use-follow-status';
import { useMe } from '@/hooks/use-me';
import { errorMessageKey } from '@/lib/api';
import { ROUTES } from '@/lib/constants';

/**
 * "Message" on someone else's profile — the ONLY way into a conversation.
 *
 * The rooms screen tells the reader to "open someone's profile to start a chat"
 * (`chat.rooms.emptyHint`), so this control is the door that copy points at. It
 * uses `POST /chat/rooms/direct`, which is find-or-create: a second press on the
 * same profile returns the existing room rather than opening a duplicate.
 *
 * Why it hides instead of failing:
 *
 *  1. **Own profile** — the backend answers `CANNOT_CHAT_WITH_SELF`, and the
 *     profile header already swaps in "Edit profile" there.
 *  2. **A block in either direction** — `CHAT_BLOCKED` (403) rejects the call.
 *     Rendering a button whose only outcome is an error message is worse than
 *     not rendering it; the block list is where that state belongs.
 *
 * It shares `useFollowStatus`/`useMe` with `FollowButton`, so on a profile that
 * already rendered a follow control these cost no extra request — same cache
 * entries.
 */
export function MessageButton({ userId, name }: { userId: number; name: string }) {
  const t = useTranslations('profile');
  const tRoot = useTranslations();
  const router = useRouter();

  const me = useMe();
  const status = useFollowStatus(userId);
  const start = useStartDirectRoom();

  if (me.isPending || status.isPending) return null;
  if (me.data?.user_id === userId) return null;
  if (status.data?.is_blocked_by_me || status.data?.has_blocked_me) return null;

  function handleClick() {
    start.mutate(userId, {
      onSuccess: (room) => {
        router.push(`${ROUTES.messages}/${String(room.id)}`);
      },
      onError: (error) => {
        toast.error(tRoot(errorMessageKey(error)));
      },
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={start.isPending}
      aria-busy={start.isPending}
      aria-label={t('messageAction', { name })}
    >
      <MessageSquare aria-hidden="true" />
      {t('message')}
    </Button>
  );
}
