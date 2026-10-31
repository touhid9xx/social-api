import { describe, expect, it } from 'vitest';

import type { MemberReadState, MessageView, RoomMemberView } from '@/lib/api/chat';

import { flattenNewestFirst, peerIdOf, peerLastReadOf, toChronological } from './chat';

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
 *  - `peerLastReadOf` answers a SEPARATE question — how far the peer has read —
 *    and it is answered by the read-receipts document, not by the member list:
 *    `RoomMemberView` is `{user_id, role, joined_at}` and carries no watermark at
 *    all. Like `peerIdOf` it returns `null` instead of guessing, because a "Seen"
 *    badge on the wrong message is a claim about someone else's behaviour.
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

/** One read-receipts row. `lastRead` is `null` until that member reads anything. */
function receipt(userId: number, lastRead: number | null): MemberReadState {
  return { user_id: userId, last_read_message_id: lastRead };
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

describe('peerLastReadOf', () => {
  it("returns the other person's watermark in a direct room", () => {
    // Room 601's fixtures: I have read up to 705, Alice up to 704.
    expect(peerLastReadOf({ type: 'direct' }, [receipt(21, 705), receipt(22, 704)], 21)).toBe(704);
  });

  it('ignores my own watermark, which is usually the furthest ahead', () => {
    // Reading my own row would label my message "Seen by them" the moment I read
    // it myself — the badge would always be on, which makes it meaningless.
    expect(peerLastReadOf({ type: 'direct' }, [receipt(21, 705), receipt(22, 703)], 21)).toBe(703);
    expect(peerLastReadOf({ type: 'direct' }, [receipt(22, 703), receipt(21, 705)], 21)).toBe(703);
  });

  it('returns null for a group room, where a single badge would be a lie', () => {
    // Three members read to three different points; "Seen" only says "somebody
    // got this far", which is not a fact worth printing.
    expect(peerLastReadOf({ type: 'group' }, [receipt(21, 803), receipt(23, 802)], 21)).toBeNull();
  });

  it('returns null while the receipts have not loaded', () => {
    // `null` means "show nothing", so the badge must not flash on before the
    // answer arrives — and must never be treated as 0.
    expect(peerLastReadOf({ type: 'direct' }, undefined, 21)).toBeNull();
  });

  it('returns null when my own id is unknown', () => {
    expect(
      peerLastReadOf({ type: 'direct' }, [receipt(21, 705), receipt(22, 704)], undefined),
    ).toBeNull();
  });

  it('returns null when the peer has no watermark yet', () => {
    // A brand-new room: the row exists, `last_read_message_id` is null. That is
    // "they have read nothing", which must surface as nothing — not as message 0.
    expect(
      peerLastReadOf({ type: 'direct' }, [receipt(21, 705), receipt(22, null)], 21),
    ).toBeNull();
  });

  it('returns null when only my own receipt row came back', () => {
    expect(peerLastReadOf({ type: 'direct' }, [receipt(21, 705)], 21)).toBeNull();
    expect(peerLastReadOf({ type: 'direct' }, [], 21)).toBeNull();
  });

  it('returns null for an ambiguous direct room rather than picking a reader', () => {
    // Unreachable through the direct-room endpoint (the pair is UNIQUE), but a
    // wrong "Seen" is a false claim about a real person, so it is refused.
    expect(
      peerLastReadOf(
        { type: 'direct' },
        [receipt(21, 705), receipt(22, 704), receipt(24, 701)],
        21,
      ),
    ).toBeNull();
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
