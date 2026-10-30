import { describe, expect, it } from 'vitest';

import type { MessageView, RoomMemberView } from '@/lib/api/chat';

import { flattenNewestFirst, peerIdOf, toChronological } from './chat';

/**
 * The pure half of the chat feature.
 *
 * Both helpers exist because of a backend fact that is easy to re-learn the hard
 * way, so each assertion below is really pinning a contract:
 *
 *  - `peerIdOf` may only name one person. A direct room's title is `null` and its
 *    participants live in a separate endpoint, so "the member who is not me" is
 *    the whole trick — and it must return `null` rather than guess whenever that
 *    member is not uniquely determinable (group, still loading, or a direct room
 *    that somehow lists three people).
 *  - `flattenNewestFirst` / `toChronological` split the API's order from the
 *    reading order. Pages arrive NEWEST-first because that is the direction
 *    "load older" pages in; reversing is a render-time concern. Reversing the
 *    query instead would corrupt the `next_cursor` anchor.
 *
 * (একটি direct room-এর নাম পাওয়া যায় শুধু সদস্য-তালিকা থেকে; আর সাজানো হয় render-এর সময়।)
 */

const ROOM_ID = 601;

function message(id: number, senderId = 22): MessageView {
  return {
    id,
    room_id: ROOM_ID,
    sender_id: senderId,
    body: `message ${String(id)}`,
    media_id: null,
    created_at: '2026-01-15T10:00:00.000Z',
    // The generated client (`src/types/api.d.ts`) requires `is_edited`, even
    // though the hand-mirrored `contracts/types.ts` marks it optional.
    is_edited: false,
  };
}

function member(userId: number): RoomMemberView {
  return { user_id: userId, role: 'member', joined_at: '2026-01-10T09:00:00.000Z' };
}

describe('peerIdOf', () => {
  it('returns the only member who is not me', () => {
    expect(peerIdOf({ type: 'direct' }, [member(21), member(22)], 21)).toBe(22);
  });

  it('does not depend on the order the members arrive in', () => {
    expect(peerIdOf({ type: 'direct' }, [member(22), member(21)], 21)).toBe(22);
    expect(peerIdOf({ type: 'direct' }, [member(21), member(22)], 22)).toBe(21);
  });

  it('returns null for a group room, which is labelled by its title', () => {
    expect(peerIdOf({ type: 'group' }, [member(21), member(23)], 21)).toBeNull();
  });

  it('returns null while the member list is still loading', () => {
    expect(peerIdOf({ type: 'direct' }, undefined, 21)).toBeNull();
  });

  it('returns null when my own id is unknown', () => {
    // `useMe` has not resolved yet: without knowing who "me" is, every member is
    // a candidate and picking one would be a guess.
    expect(peerIdOf({ type: 'direct' }, [member(21), member(22)], undefined)).toBeNull();
  });

  it('returns null for a direct room that lists only me', () => {
    expect(peerIdOf({ type: 'direct' }, [member(21)], 21)).toBeNull();
  });

  it('returns null when a direct room is ambiguous', () => {
    // Should never happen (the pair is unique by constraint), but a wrong name on
    // screen is worse than the fallback label.
    expect(peerIdOf({ type: 'direct' }, [member(21), member(22), member(24)], 21)).toBeNull();
  });

  it('returns null for an empty member list', () => {
    expect(peerIdOf({ type: 'direct' }, [], 21)).toBeNull();
  });
});

describe('flattenNewestFirst', () => {
  it('concatenates pages in server order, newest first', () => {
    const flat = flattenNewestFirst([
      { items: [message(705), message(704)] },
      { items: [message(703), message(702)] },
    ]);

    expect(flat.map((item) => item.id)).toEqual([705, 704, 703, 702]);
  });

  it('drops duplicates across pages, keeping the first occurrence', () => {
    // The overlap a live room produces: a message written between two page reads
    // shows up at the tail of page 0 and the head of page 1.
    const flat = flattenNewestFirst([
      { items: [message(705), message(704)] },
      { items: [message(704), message(703)] },
    ]);

    expect(flat.map((item) => item.id)).toEqual([705, 704, 703]);
  });

  it('returns an empty list when nothing has loaded', () => {
    expect(flattenNewestFirst(undefined)).toEqual([]);
    expect(flattenNewestFirst([])).toEqual([]);
    expect(flattenNewestFirst([{ items: [] }])).toEqual([]);
  });
});

describe('toChronological', () => {
  it('reverses the merged pages into reading order', () => {
    const chronological = toChronological([
      { items: [message(705), message(704)] },
      { items: [message(703), message(701)] },
    ]);

    expect(chronological.map((item) => item.id)).toEqual([701, 703, 704, 705]);
  });

  it('deduplicates before reversing, so a repeat does not land twice', () => {
    const chronological = toChronological([
      { items: [message(705), message(704)] },
      { items: [message(704), message(703)] },
    ]);

    expect(chronological.map((item) => item.id)).toEqual([703, 704, 705]);
  });

  it('does not mutate the cached pages', () => {
    // `reverse()` on a page's own array would reorder the query cache in place and
    // make the next render flip the thread again.
    const page = { items: [message(705), message(704)] };
    toChronological([page]);

    expect(page.items.map((item) => item.id)).toEqual([705, 704]);
  });

  it('returns an empty list when nothing has loaded', () => {
    expect(toChronological(undefined)).toEqual([]);
  });
});
