import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { MessageView } from '@/lib/api/chat';
import { IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { MessageComposer } from './message-composer';

/**
 * The message box.
 *
 * Enter sends and Shift+Enter breaks the line — that pair is the whole reason the
 * control is a `Textarea` with a keydown guard, so both halves are asserted. The
 * rest of the file pins the two failure behaviours that decide whether the
 * composer is usable:
 *
 *  - a rejected send must KEEP the draft (retyping a paragraph because the
 *    network blinked is the worse outcome), and
 *  - nothing may be sent that the schema would reject, so a blank draft costs no
 *    request at all.
 *
 * The writes are not optimistic, so the bubble is not this component's problem —
 * `useSendMessage` patches the thread cache. What is asserted here is the request
 * (body + idempotency key) and the local state.
 */

const ROOM_ID = 601;
const MESSAGES_PATH = '*/api/v1/chat/rooms/:room_id/messages';

function created(body: string): MessageView {
  return {
    id: 970,
    room_id: ROOM_ID,
    sender_id: 21,
    body,
    media_id: null,
    created_at: '2026-02-01T09:00:00.000Z',
    is_edited: false,
  };
}

function captureSends() {
  const sent: Array<{ body: string; key: string | null }> = [];

  server.use(
    http.post(MESSAGES_PATH, async ({ request }) => {
      const payload = (await request.json()) as { body: string };
      sent.push({ body: payload.body, key: request.headers.get(IDEMPOTENCY_HEADER) });

      return HttpResponse.json(created(payload.body.trim()), { status: 201 });
    }),
  );

  return sent;
}

describe('MessageComposer', () => {
  it('sends the trimmed draft on Enter, with an idempotency key', async () => {
    const sent = captureSends();

    const user = userEvent.setup();
    renderWithProviders(<MessageComposer roomId={ROOM_ID} />);

    const box = screen.getByLabelText('Message');
    await user.type(box, '  Hello there  {Enter}');

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });

    expect(sent[0]?.body).toBe('Hello there');
    // The backend dedupes a retried submit on this header, so an absent key would
    // turn one flaky network into two messages.
    expect(sent[0]?.key).toBeTruthy();
    expect(sent[0]?.key?.length).toBeGreaterThanOrEqual(8);

    // The draft clears only after the server accepted it.
    await waitFor(() => {
      expect(box).toHaveValue('');
    });
  });

  it('breaks the line on Shift+Enter without sending', async () => {
    const sent = captureSends();

    const user = userEvent.setup();
    renderWithProviders(<MessageComposer roomId={ROOM_ID} />);

    const box = screen.getByLabelText('Message');
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');

    expect(box).toHaveValue('line one\nline two');
    expect(sent).toHaveLength(0);
  });

  it('refuses a blank draft without making a request', async () => {
    const sent = captureSends();

    const user = userEvent.setup();
    renderWithProviders(<MessageComposer roomId={ROOM_ID} />);

    // Whitespace is empty: the schema trims before it measures.
    await user.type(screen.getByLabelText('Message'), '   ');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Write something before sending.')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it('keeps the draft when the send fails', async () => {
    const ERROR_BODY: ApiErrorBody = {
      error: 'RATE_LIMITED',
      status: 429,
      detail: 'test',
      path: `/api/v1/chat/rooms/${String(ROOM_ID)}/messages`,
      request_id: 'test-request-id',
    };

    server.use(
      http.post(MESSAGES_PATH, () => HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status })),
    );

    const user = userEvent.setup();
    renderWithProviders(<MessageComposer roomId={ROOM_ID} />);

    const box = screen.getByLabelText('Message');
    await user.type(box, 'retry me');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The point of the test: a failed send does not eat the text.
    expect(box).toHaveValue('retry me');
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderWithProviders(<MessageComposer roomId={ROOM_ID} />, { locale: 'bn' });

    expect(screen.getByLabelText('বার্তা')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পাঠান' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'একটি বার্তা লিখুন' })).toBeInTheDocument();
  });
});
