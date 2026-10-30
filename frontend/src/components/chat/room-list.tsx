'use client';

import { MessageCircleOff, MessagesSquare, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import { useMe } from '@/hooks/use-me';
import { useRoomMembers, useRooms } from '@/hooks/use-rooms';
import type { RoomView } from '@/lib/api/chat';
import { peerIdOf } from '@/lib/chat';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';

/**
 * The conversation list — [contracts/api_reference.md].
 *
 * Two things about this endpoint shape the component:
 *
 * 1. `GET /chat/rooms` returns a BARE ARRAY, capped at 100 and ordered by latest
 *    activity. There is no cursor, so there is no "load more" — showing a
 *    non-existent pagination control would be a lie.
 * 2. `RoomView` holds no participants and no last message. The peer of a direct
 *    room is therefore resolved through `GET /rooms/{id}/members` per row (see
 *    `peerIdOf`), which is one small request per conversation — acceptable
 *    because the list is bounded at 100 by the server, and the alternative (no
 *    peer) makes a direct room unrenderable.
 *
 * There is deliberately no unread badge: unread is a PER-ROOM endpoint, so
 * badges would mean one request per row on every list render. The honest place
 * for "unread" is inside a thread, and the nav badge is fed by the notification
 * counter, not by chat.
 */

function RoomSkeleton() {
  const t = useTranslations('chat.rooms');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
        >
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RoomRow({ room }: { room: RoomView }) {
  const t = useTranslations('chat.rooms');
  const locale = useLocale();

  const { data: me } = useMe();
  const { data: members } = useRoomMembers(room.id);
  const peerId = peerIdOf(room, members?.members, me?.user_id);
  const { data: peer } = useAuthor(peerId ?? undefined);

  const isDirect = room.type === 'direct';
  const name = isDirect ? (peer?.display_name?.trim() ?? '') : (room.title?.trim() ?? '');
  const label = name || (isDirect ? t('directFallback') : t('groupFallback'));
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <li>
      <Link
        href={`${ROUTES.messages}/${String(room.id)}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar size="default">
          {peer?.avatar_url ? <AvatarImage src={peer.avatar_url} alt="" /> : null}
          <AvatarFallback aria-hidden="true">
            {isDirect ? initial : <Users aria-hidden="true" className="size-4" />}
          </AvatarFallback>
        </Avatar>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{label}</span>

          <span className="block text-xs text-muted-foreground">
            {isDirect ? t('directKind') : t('groupKind', { count: members?.members.length ?? 0 })}
          </span>
        </span>

        <time
          dateTime={room.updated_at}
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(room.updated_at, locale)}
        </time>
      </Link>
    </li>
  );
}

export function RoomList() {
  const t = useTranslations('chat.rooms');
  const { data, isPending, isError, isFetching, refetch } = useRooms();

  if (isPending) return <RoomSkeleton />;

  if (isError) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h2 className="text-base font-semibold text-foreground">{t('errorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
        <MessageCircleOff aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
        <p className="inline-flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <MessagesSquare aria-hidden="true" className="size-3.5" />
          {t('emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {data.map((room) => (
        <RoomRow key={room.id} room={room} />
      ))}
    </ul>
  );
}
