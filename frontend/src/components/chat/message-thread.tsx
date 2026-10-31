'use client';

import { Loader2, MessagesSquare, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import { useDeleteMessage, useMarkRead } from '@/hooks/use-chat-actions';
import { useMe } from '@/hooks/use-me';
import { usePresence } from '@/hooks/use-presence';
import { useReadReceipts } from '@/hooks/use-read-receipts';
import { useRoomLive } from '@/hooks/use-room-live';
import { useRoomMessages } from '@/hooks/use-room-messages';
import { useRoom, useRoomMembers } from '@/hooks/use-rooms';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import type { MessageView } from '@/lib/api/chat';
import { mediaUrl } from '@/lib/api/media';
import { flattenNewestFirst, peerIdOf, peerLastReadOf, toChronological } from '@/lib/chat';
import { ROUTES } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

import { MessageComposer } from './message-composer';

/**
 * One conversation.
 *
 * Three backend facts drive the shape of this component:
 *
 *  1. Pages arrive NEWEST-first (`created_at DESC, id DESC`) because that is the
 *     direction "load older" pages in. Reading order — oldest at the top — is a
 *     render-time reversal (`toChronological`), never a reversed query: the
 *     `next_cursor` of each page is built from its last (oldest) row, so flipping
 *     the list before paging would hand the server the wrong anchor.
 *
 *  2. `RoomView` has no participants and a direct room has `title: null`, so the
 *     header's name comes from `GET /rooms/{id}/members` → the member that is not
 *     me → that user's public profile. Group rooms use `title`.
 *
 *  3. `POST /rooms/{id}/read` is not "mark everything read": it takes an explicit
 *     `message_id` and the backend rejects an id it has not seen (400
 *     `READ_RECEIPT_INVALID`). So the newest message that actually loaded is the
 *     only honest thing to send, and it is sent once per distinct id — see the
 *     effect below.
 *
 * The composer is rendered outside the message-list branches on purpose: a thread
 * that failed to load must not take away the ability to write into it. It is *not*
 * rendered when the room itself 404s/403s, because then there is no room to write
 * into.
 *
 * 4. Liveness comes from the socket, not a poll. `useRoomLive` subscribes this
 *    room's channel on mount (a room channel is silent until joined) and patches
 *    pushed messages straight into this exact cache shape, which is why the "Seen"
 *    badge and the typing line below can be trusted without a refetch. Presence is
 *    the one thing the socket *cannot* push — see `lib/api/presence.ts`.
 */
export function MessageThread({ roomId }: { roomId: number }) {
  const t = useTranslations('chat.thread');
  const tRooms = useTranslations('chat.rooms');

  const { data: me } = useMe();
  const room = useRoom(roomId);
  const members = useRoomMembers(roomId);
  const messages = useRoomMessages(roomId);

  const peerId = room.data ? peerIdOf(room.data, members.data?.members, me?.user_id) : null;
  const { data: peer } = useAuthor(peerId ?? undefined);

  // "Seen" is a DIRECT-room idea only: a group has many readers and one badge
  // would be a lie, so the query is not even issued for it. The watermark lives
  // on the receipts document, not on the members list — see `peerLastReadOf`.
  const receipts = useReadReceipts(room.data?.type === 'direct' ? roomId : undefined);
  const peerLastRead = room.data
    ? peerLastReadOf(room.data, receipts.data?.members, me?.user_id)
    : null;

  // Both live hooks are declared here, ABOVE the `isPending` early return: a hook
  // that only ran once the room resolved would change the hook order between
  // renders, which React rejects.
  const { typingIds, notifyTyping } = useRoomLive(roomId);
  const { data: presence } = usePresence(
    room.data?.type === 'direct' ? (peerId ?? undefined) : undefined,
  );

  const { mutate: markRead } = useMarkRead();
  const lastMarked = useRef<number | null>(null);
  const newestId = messages.data ? flattenNewestFirst(messages.data.pages)[0]?.id : undefined;

  useEffect(() => {
    // `undefined` while the first page loads, or when the room is empty. The ref
    // is what makes this fire once per id rather than once per render.
    if (newestId === undefined || lastMarked.current === newestId) return;
    lastMarked.current = newestId;
    // Best effort: a read receipt that failed is not worth interrupting the
    // reader, and the next message will move the watermark anyway.
    markRead({ roomId, messageId: newestId });
  }, [markRead, newestId, roomId]);

  if (room.isPending) return <ThreadSkeleton />;

  if (room.isError || !room.data) {
    const gone =
      isAppApiError(room.error) && (room.error.status === 404 || room.error.status === 403);

    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
        >
          <h2 className="text-base font-semibold text-foreground">
            {gone ? t('unavailableTitle') : t('errorTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {gone ? t('unavailableBody') : t('errorBody')}
          </p>

          {gone ? null : (
            <Button
              variant="outline"
              onClick={() => void room.refetch()}
              disabled={room.isFetching}
            >
              {tRooms('retry')}
            </Button>
          )}
        </div>

        <BackToRooms label={t('backToRooms')} />
      </div>
    );
  }

  const isGroup = room.data.type === 'group';
  const title = isGroup
    ? room.data.title?.trim() || tRooms('groupFallback')
    : peer?.display_name?.trim() || tRooms('directFallback');

  const items = toChronological(messages.data?.pages);

  // Only the NEWEST message of mine can carry the badge — repeating "Seen" down
  // the whole column would say nothing the bottom line does not already say.
  // `lastOwnId === null` means I have written nothing yet, so nothing to mark.
  const myId = me?.user_id;
  const lastOwnId =
    myId === undefined
      ? null
      : items.reduce<number | null>(
          (last, item) => (item.sender_id === myId ? item.id : last),
          null,
        );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <BackToRooms label={t('backToRooms')} />

        <span className="shrink-0 text-xs text-muted-foreground">
          {isGroup
            ? tRooms('groupKind', { count: members.data?.members.length ?? 0 })
            : tRooms('directKind')}
        </span>
      </div>

      <section aria-label={t('title')} className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h2>

          {/* Presence is pulled, never pushed (`lib/api/presence.ts`), so nothing
              renders until the first answer lands: flashing "Offline" at a reader
              looking at an online person would be a lie. A group header has no
              single subject, so it shows no dot at all. */}
          {isGroup || !presence ? null : (
            <span
              aria-live="polite"
              className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 rounded-full',
                  presence.online ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              />
              {presence.online ? t('online') : t('offline')}
            </span>
          )}
        </div>

        {messages.isPending ? (
          <div aria-busy="true" aria-live="polite" className="space-y-3">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-10 w-3/5" />
          </div>
        ) : messages.isError ? (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
          >
            <h3 className="text-base font-semibold text-foreground">{t('messagesErrorTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('messagesErrorBody')}</p>
            <Button
              variant="outline"
              onClick={() => void messages.refetch()}
              disabled={messages.isFetching}
            >
              {tRooms('retry')}
            </Button>
          </div>
        ) : (
          <>
            {messages.hasNextPage || messages.isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2">
                {messages.isFetchNextPageError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('loadOlderFailed')}
                  </p>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void messages.fetchNextPage()}
                  disabled={messages.isFetchingNextPage}
                >
                  {messages.isFetchingNextPage ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : null}
                  {messages.isFetchingNextPage ? t('loadingOlder') : t('loadOlder')}
                </Button>
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
                <MessagesSquare aria-hidden="true" className="size-6 text-muted-foreground" />
                <h3 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h3>
                <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    mine={message.sender_id === me?.user_id}
                    seen={
                      message.id === lastOwnId &&
                      peerLastRead !== null &&
                      message.id <= peerLastRead
                    }
                    showSender={isGroup}
                    roomId={roomId}
                  />
                ))}
              </ul>
            )}
          </>
        )}

        <TypingLine ids={typingIds} isGroup={isGroup} />

        <MessageComposer roomId={roomId} onTyping={notifyTyping} />
      </section>
    </div>
  );
}

/**
 * "typing…" above the composer.
 *
 * A direct room already names the peer in the header, so the line stays a bare
 * verb. A group has no single subject, so the first typist's name is resolved
 * through the same `useAuthor` cache a message row uses — free when that person
 * has already spoken here. `aria-live="polite"` is load-bearing: without it the
 * indicator is a visual pulse that only sighted users ever notice.
 */
function TypingLine({ ids, isGroup }: { ids: number[]; isGroup: boolean }) {
  const t = useTranslations('chat.thread');
  // Hoisted out of `ids` before the guard: with `noUncheckedIndexedAccess`, `ids[0]`
  // keeps type `number | undefined` at every use site, and the fallback copy takes a
  // definite id. Narrowing the binding once is what makes the interpolation type-check.
  const firstId = ids[0];
  // Called unconditionally — hooks cannot be skipped for the empty case below,
  // and `useAuthor(undefined)` is a disabled query, not a request.
  const { data: first } = useAuthor(firstId);

  if (firstId === undefined) return null;

  const label =
    ids.length > 1
      ? t('typingGroupMany', { count: ids.length })
      : isGroup
        ? t('typingGroup', {
            name: first?.display_name?.trim() || t('senderFallback', { id: firstId }),
          })
        : t('typing');

  return (
    <p aria-live="polite" className="px-1 text-xs text-muted-foreground">
      {label}
    </p>
  );
}

function BackToRooms({ label }: { label: string }) {
  return (
    <Link
      href={ROUTES.messages}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {label}
    </Link>
  );
}

function ThreadSkeleton() {
  const t = useTranslations('chat.thread');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="ml-auto h-10 w-1/2" />
    </div>
  );
}

function MessageRow({
  message,
  mine,
  seen,
  showSender,
  roomId,
}: {
  message: MessageView;
  mine: boolean;
  /** The peer's read watermark has reached this row. Never true for a group. */
  seen: boolean;
  showSender: boolean;
  roomId: number;
}) {
  const t = useTranslations('chat.thread');
  const tRoot = useTranslations();
  const locale = useLocale();

  const { data: sender } = useAuthor(message.sender_id);
  const remove = useDeleteMessage();

  const senderName = sender?.display_name?.trim() || t('senderFallback', { id: message.sender_id });

  function handleDelete() {
    remove.mutate(
      { roomId, messageId: message.id },
      { onError: (error) => toast.error(tRoot(errorMessageKey(error))) },
    );
  }

  return (
    <li className={cn('flex items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
      {mine ? null : (
        <Avatar size="sm">
          {sender?.avatar_url ? <AvatarImage src={mediaUrl(sender.avatar_url)} alt="" /> : null}
          <AvatarFallback aria-hidden="true">{senderName.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}

      <div className={cn('max-w-[80%] min-w-0 space-y-1', mine ? 'items-end text-right' : '')}>
        {showSender && !mine ? (
          <p className="px-1 text-xs font-medium text-muted-foreground">{senderName}</p>
        ) : null}

        <p
          className={cn(
            'rounded-xl border px-3 py-2 text-sm break-words whitespace-pre-wrap',
            mine
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-foreground',
          )}
        >
          {message.body}
        </p>

        <div
          className={cn(
            'flex items-center gap-2 px-1 text-xs text-muted-foreground',
            mine ? 'justify-end' : 'justify-start',
          )}
        >
          <time dateTime={message.created_at}>
            {formatRelativeTime(message.created_at, locale)}
          </time>

          {message.is_edited ? <span>{t('edited')}</span> : null}

          {seen ? <span className="font-medium text-foreground">{t('seen')}</span> : null}

          {mine ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('deleteAction')}
              disabled={remove.isPending}
              onClick={handleDelete}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
