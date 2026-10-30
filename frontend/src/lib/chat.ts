import type { MessagePage, MessageView, RoomMemberView, RoomView } from '@/lib/api/chat';

/**
 * Pure helpers for chat screens, kept out of the components so they can be
 * tested without a DOM or a network.
 */

/**
 * The other person in a direct room.
 *
 * `RoomView` carries no participants and a direct room has `title: null`, so the
 * peer is DERIVED: it is the member that is not me. Returns `null` when there is
 * no unambiguous answer — a group (many peers, the title is the label), a room
 * whose members have not loaded, or the corner case of a direct room that somehow
 * lists only me.
 *
 * A signature must not guess here: rendering "Unknown" forever because we picked
 * the wrong id is worse than rendering nothing while the members query settles.
 */
export function peerIdOf(
  room: Pick<RoomView, 'type'>,
  members: readonly RoomMemberView[] | undefined,
  meId: number | undefined,
): number | null {
  if (room.type !== 'direct' || meId === undefined) return null;

  const others = members?.filter((member) => member.user_id !== meId) ?? [];
  // `others[0]` is `RoomMemberView | undefined` under `noUncheckedIndexedAccess`,
  // so read it once and let the `null` fall through to the same "don't guess" path.
  const only = others.length === 1 ? others[0] : undefined;
  return only?.user_id ?? null;
}

/**
 * All loaded pages as one list, newest first, with duplicates dropped.
 *
 * Pages overlap far more in chat than in a feed: a message can be written
 * between two page fetches, and a sent message is inserted into page 0 while the
 * server may also return it on the next older page. Keeping the first occurrence
 * preserves the server's ordering.
 */
export function flattenNewestFirst(
  pages: ReadonlyArray<Pick<MessagePage, 'items'>> | undefined,
): MessageView[] {
  const seen = new Set<number>();
  const items: MessageView[] = [];

  for (const page of pages ?? []) {
    for (const message of page.items) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      items.push(message);
    }
  }

  return items;
}

/**
 * The same messages in reading order — oldest at the top, newest at the bottom.
 *
 * The API pages newest-first because that is the direction "load older" needs.
 * Reversing happens HERE, at render time, and never in the query: each page's
 * `next_cursor` is built from its last (oldest) row, so a reversed page would
 * hand the server the wrong anchor.
 */
export function toChronological(pages: ReadonlyArray<Pick<MessagePage, 'items'>> | undefined) {
  return flattenNewestFirst(pages).reverse();
}
