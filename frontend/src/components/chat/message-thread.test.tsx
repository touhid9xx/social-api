import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { WebSocketProvider } from '@/components/shared/websocket-provider';
import { useReadReceipts } from '@/hooks/use-read-receipts';
import type { MessagePage, MessageView, ReadReceiptsList } from '@/lib/api/chat';
import { renderWithProviders } from '@/lib/testing/render';
import { roomMessages } from '@/mocks/fixtures';
import { server } from '@/mocks/server';

import { MessageThread } from './message-thread';

/**
 * One conversation.
 *
 * The three behaviours worth pinning are the three places this screen could
 * silently lie:
 *
 *  - **Reading order is a render-time reversal.** Pages arrive newest-first, so a
 *    component that rendered them as received would put the newest message at the
 *    top and the conversation would read backwards. The cursor direction must stay
 *    untouched, which is why `toChronological` reverses a flattened copy.
 *  - **"Load older" asks for the OLDER slice.** The cursor comes back from the
 *    server; the client only echoes it. Paging the other way would return the same
 *    page forever.
 *  - **The read watermark is the newest message that actually loaded**, sent once
 *    per distinct id. Firing on every render would be one POST per paint.
 *  - **"Seen" is a claim about a real person.** It comes from the peer's
 *    read-receipt watermark, so it may only appear on my NEWEST message and only
 *    once that watermark has actually reached it. A badge on an older row of mine,
 *    a badge in a group room, or a badge the peer has not earned are all lies.
 *
 * Room 601 is the direct room (peer = Alice, user 22) and its five fixture
 * messages make a `limit=3` read produce exactly two pages.
 */

const ROOM_ID = 601;
const GROUP_ROOM_ID = 602;

function rows(roomId = ROOM_ID): MessageView[] {
  const fixture = roomMessages[roomId];
  if (!fixture) throw new Error(`fixture messages for room ${String(roomId)} are missing`);

  // `contracts/types.ts` (what the fixtures are typed against) leaves
  // `is_edited` optional, while the generated OpenAPI client requires it. Same
  // mismatch as `ConsentRecord.channel` — narrow once, here.
  return fixture.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    body: row.body,
    media_id: row.media_id,
    created_at: row.created_at,
    is_edited: row.is_edited ?? false,
  }));
}

function textOfListItems(): string[] {
  return screen.queryAllByRole('listitem').map((item) => item.textContent ?? '');
}

/**
 * The thread is not standalone UI: `useRoomLive` reaches for the app-wide socket
 * context, which the root layout mounts and `renderWithProviders` does not. The
 * wrapper is local on purpose — teaching the shared render helper to tolerate a
 * missing provider would hide that dependency in the app too. No access token is
 * set in this file, so the provider stays disconnected and only supplies
 * `joinRoom`/`subscribe`, exactly like an anonymous page.
 */
function renderThread(ui: ReactElement, options?: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(<WebSocketProvider>{ui}</WebSocketProvider>, options);
}

/**
 * Subscribes to the SAME receipts query the thread does, so a test can wait for
 * "the watermark has been applied" rather than guessing. Without it a "no Seen
 * badge" assertion would pass just as happily while the request was still in
 * flight — the failure mode of every absence test.
 */
function ReceiptsProbe({ roomId = ROOM_ID }: { roomId?: number }) {
  const { data } = useReadReceipts(roomId);
  return <span data-testid="receipts">{data ? 'loaded' : 'pending'}</span>;
}

describe('MessageThread', () => {
  it('renders the conversation oldest-first and names a direct room after its peer', async () => {
    renderThread(<MessageThread roomId={ROOM_ID} />);

    expect(await screen.findByText('Hey! Did the pagination land?')).toBeInTheDocument();

    // Peer resolved from the member list (601 = admin 21 + Alice 22), not from a
    // `title` the direct room does not have.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Alice Rahman');
    expect(screen.getByRole('link', { name: 'All conversations' })).toHaveAttribute(
      'href',
      '/messages',
    );

    const items = textOfListItems();
    expect(items).toHaveLength(rows().length);
    // Fixture order is 705 → 701 (newest first); reading order is the reverse.
    expect(items[0]).toContain('Hey! Did the pagination land?');
    expect(items[items.length - 1]).toContain("Sounds good — I'll push it tonight.");
  });

  it('loads older messages from the cursor the server returned', async () => {
    // The component asks with the default page size, so this test owns the paging
    // shape: three rows per page turns the five fixtures into two pages.
    const CURSOR_PATH = '*/api/v1/chat/rooms/:room_id/messages';

    server.use(
      http.get(CURSOR_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const start = cursor === null ? 0 : Number(cursor);
        const items = rows().slice(start, start + 3);
        const end = start + items.length;

        const page: MessagePage = {
          items,
          next_cursor: end < rows().length ? String(end) : null,
        };
        return HttpResponse.json(page);
      }),
    );

    const user = userEvent.setup();
    renderThread(<MessageThread roomId={ROOM_ID} />);

    // Page 1 holds the three NEWEST messages: 705, 704, 703 → displayed 703…705.
    expect(await screen.findByText("Let's ship the cursor fix first.")).toBeInTheDocument();
    expect(screen.queryByText('Hey! Did the pagination land?')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load older messages' }));

    expect(await screen.findByText('Hey! Did the pagination land?')).toBeInTheDocument();
    // The older page slots in ABOVE the newer one, not below it.
    const items = textOfListItems();
    expect(items).toHaveLength(rows().length);
    expect(items[0]).toContain('Hey! Did the pagination land?');
    expect(items[1]).toContain('The thread reverses at render time.');
    // Both pages loaded, so there is nothing older left to ask for.
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
  });

  it('marks the newest loaded message read exactly once', async () => {
    const watermarks: number[] = [];

    server.use(
      http.post('*/api/v1/chat/rooms/:room_id/read', async ({ request }) => {
        const body = (await request.json()) as { message_id: number };
        watermarks.push(body.message_id);

        return HttpResponse.json({
          user_id: 21,
          last_read_message_id: body.message_id,
        });
      }),
    );

    renderThread(<MessageThread roomId={ROOM_ID} />);

    await screen.findByText('Hey! Did the pagination land?');

    await waitFor(() => {
      expect(watermarks).toHaveLength(1);
    });

    // 705 is the newest fixture row — the only honest watermark for "I read what
    // is on screen". A second POST here would mean the ref-driven guard failed.
    expect(watermarks).toEqual([705]);
  });

  it('marks only my newest message as seen, and only once the peer reached it', async () => {
    renderThread(<MessageThread roomId={ROOM_ID} />);

    // Alice's fixture watermark is exactly 704, which is my newest own row; the
    // next one down (702) sits above the boundary. `findAllByText` waits for the
    // badge, so "no badge on 702" is a result rather than a race.
    const badges = await screen.findAllByText('Seen');
    expect(badges).toHaveLength(1);

    const items = screen.getAllByRole('listitem');
    const rowFor = (body: string) => {
      const row = items.find((item) => item.textContent?.includes(body));
      if (!row) throw new Error(`no row rendered for "${body}"`);
      return row;
    };

    expect(within(rowFor('Then it is a plan.')).getByText('Seen')).toBeInTheDocument();
    // Also mine, but not the newest: repeating the badge down the column would
    // say nothing the bottom line does not already say.
    expect(within(rowFor('The thread reverses at render time.')).queryByText('Seen')).toBeNull();
    // Alice's own rows can never carry it, however far her own watermark is.
    expect(within(rowFor("Sounds good — I'll push it tonight.")).queryByText('Seen')).toBeNull();
  });

  it('shows no seen badge while the peer is behind my newest message', async () => {
    server.use(
      http.get('*/api/v1/chat/rooms/:room_id/read-receipts', () =>
        // Alice read up to 703: past my OLDER message (702), short of my newest.
        HttpResponse.json<ReadReceiptsList>({
          members: [
            { user_id: 21, last_read_message_id: 704 },
            { user_id: 22, last_read_message_id: 703 },
          ],
        }),
      ),
    );

    renderThread(
      <>
        <MessageThread roomId={ROOM_ID} />
        <ReceiptsProbe />
      </>,
    );

    await screen.findByText('Hey! Did the pagination land?');
    // The probe shares the query, so this proves the watermark was fetched and
    // applied. Without it the assertion below would pass on a pending request.
    await waitFor(() => {
      expect(screen.getByTestId('receipts')).toHaveTextContent('loaded');
    });

    expect(screen.queryByText('Seen')).toBeNull();
  });

  it('never marks a group room as seen and never asks for its receipts', async () => {
    let receiptReads = 0;

    server.use(
      http.get('*/api/v1/chat/rooms/:room_id/read-receipts', () => {
        receiptReads += 1;
        return HttpResponse.json<ReadReceiptsList>({ members: [] });
      }),
    );

    renderThread(<MessageThread roomId={GROUP_ROOM_ID} />);

    // The group title and my own message (802) are both on screen, so the room,
    // member and message queries have all settled by this point.
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('Design crew');
    expect(screen.getByText('A group room needs a title — this one has it.')).toBeInTheDocument();

    // A group has many readers, so a single badge would be a lie: the query is
    // disabled outright rather than fetched and thrown away.
    expect(receiptReads).toBe(0);
    expect(screen.queryByText('Seen')).toBeNull();
  });

  it('offers a delete control only on my own messages', async () => {
    const deleted: string[] = [];

    server.use(
      http.delete('*/api/v1/chat/messages/:message_id', ({ params }) => {
        deleted.push(String(params.message_id));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderThread(<MessageThread roomId={ROOM_ID} />);

    await screen.findByText('Hey! Did the pagination land?');

    // Rows 704 and 702 are mine (sender 21); the rest are Alice's.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete message' });
    expect(deleteButtons).toHaveLength(2);

    const [firstMine] = deleteButtons;
    if (!firstMine) throw new Error('expected a delete control on my own message');
    await user.click(firstMine);

    await waitFor(() => {
      expect(deleted).toHaveLength(1);
    });

    // Reading order puts 702 above 704, so the first control belongs to message
    // 702. The row leaves the cache by id — no refetch — and the rest stay put.
    expect(deleted).toEqual(['702']);
    await waitFor(() => {
      expect(screen.queryByText('The thread reverses at render time.')).toBeNull();
    });
    expect(screen.getByText('Then it is a plan.')).toBeInTheDocument();
  });

  it('reports an inaccessible room without offering a composer', async () => {
    renderThread(<MessageThread roomId={9999} />);

    expect(await screen.findByText("This conversation isn't available")).toBeInTheDocument();
    // A room that 404s has nowhere to write into, so the composer must be gone.
    expect(screen.queryByRole('form', { name: 'Write a message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderThread(<MessageThread roomId={ROOM_ID} />, { locale: 'bn' });

    // One page of five fixture rows (below the default page size), so there is no
    // "load older" control to assert — the Bangla copy checked here is the header
    // link and the composer, both of which render on every load.
    expect(await screen.findByRole('link', { name: 'সব কথোপকথন' })).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'একটি বার্তা লিখুন' });
    expect(within(form).getByRole('button', { name: 'পাঠান' })).toBeInTheDocument();
  });
});
