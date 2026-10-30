import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { postComments } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { CommentThread } from './comment-thread';

/**
 * One post's thread, driven directly.
 *
 * `post-detail.test.tsx` covers the page; this covers the list's own edges. The
 * one that matters most is a failed *next page*: a cursor request that 404s must
 * leave the comments already read on screen and say so, rather than replacing a
 * half-read thread with a page-level error. `CommentThread` guards that with
 * `isError && comments.length === 0`, and until now nothing exercised it.
 *
 * jsdom has no IntersectionObserver, so — as in `home-feed.test.tsx` — every
 * assertion drives the "Load more" button, which is the path a keyboard user
 * takes anyway.
 *
 * The missing cursor answers 404 on purpose: the shared client never retries a
 * 4xx, so the failure lands immediately instead of waiting out a 5xx backoff.
 *
 * (পরের পাতা ব্যর্থ হলেও আগের কমেন্টগুলো স্ক্রিনে থাকে।)
 */

const COMMENTS_PATH = '/api/v1/posts/:post_id/comments';

/**
 * The fixture's own element type. `@/lib/api/comments`'s `CommentView` is
 * generated from the OpenAPI schema, where `is_edited`/`is_liked_by_me` carry
 * defaults and are therefore optional; `contracts/types.ts` declares them
 * required. Both describe the same JSON, so derive from the data actually served
 * instead of importing a second, subtly different spelling of it.
 */
type ApiComment = (typeof postComments)[number];

type Page = { items: ApiComment[]; next: string | null };

function comment(id: number): ApiComment {
  const found = postComments.find((item) => item.id === id);
  if (!found) throw new Error(`fixture comment ${String(id)} is missing`);
  return found;
}

const ERROR_BODY: ApiErrorBody = {
  error: 'COMMENT_NOT_FOUND',
  status: 404,
  detail: 'test',
  path: '/api/v1/posts/101/comments',
  request_id: 'test-request-id',
};

/** Serve a cursor-keyed thread. A cursor with no page is a 404. */
function serveThread(pages: Record<string, Page>) {
  server.use(
    http.get(`*${COMMENTS_PATH}`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor') ?? 'first';
      const page = pages[cursor];

      if (!page) {
        return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });
      }

      return HttpResponse.json({ items: page.items, next_cursor: page.next });
    }),
  );
}

describe('CommentThread', () => {
  it('appends the next page when "Load more" is pressed', async () => {
    serveThread({
      first: { items: [comment(501)], next: 'c1' },
      c1: { items: [comment(502)], next: null },
    });

    const user = userEvent.setup();
    renderWithProviders(<CommentThread postId={101} />);

    expect(await screen.findByText(comment(501).body)).toBeInTheDocument();
    expect(screen.queryByText(comment(502).body)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more comments' }));

    expect(await screen.findByText(comment(502).body)).toBeInTheDocument();
    // The last page ends the thread: the control is gone, not merely disabled.
    expect(screen.queryByRole('button', { name: 'Load more comments' })).toBeNull();
  });

  it('reports a failed load-more without losing the comments already shown', async () => {
    // Only the first page exists, so the cursor request 404s.
    serveThread({ first: { items: [comment(501)], next: 'c1' } });

    const user = userEvent.setup();
    renderWithProviders(<CommentThread postId={101} />);

    expect(await screen.findByText(comment(501).body)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more comments' }));

    expect(await screen.findByText("Couldn't load more comments. Try again.")).toBeInTheDocument();
    // The half-read thread survives: a failed next page is not a failed thread.
    expect(screen.getByText(comment(501).body)).toBeInTheDocument();
    // …and the page-level error never took over.
    expect(screen.queryByText("Couldn't load your feed")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers "Reply" on top-level comments only', async () => {
    // The server caps depth at 2, so a reply-to-a-reply could only ever be a
    // real COMMENT_DEPTH_EXCEEDED. Comment 503 is the inline reply to 501.
    serveThread({ first: { items: [comment(501)], next: null } });

    renderWithProviders(<CommentThread postId={101} />);

    expect(await screen.findByText(comment(501).body)).toBeInTheDocument();
    expect(screen.getByText('Glad it landed.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();

    // Scope to the nested <ul> that holds 503's item, and assert no reply
    // control is reachable inside it.
    const reply = screen.getByText('Glad it landed.');
    const replyItem = reply.closest('li');
    expect(replyItem).not.toBeNull();
    expect(within(replyItem as HTMLElement).queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('shows the empty state for a post with no comments', async () => {
    serveThread({ first: { items: [], next: null } });

    renderWithProviders(<CommentThread postId={101} />);

    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders Bangla copy under the bn locale', async () => {
    serveThread({ first: { items: [], next: null } });

    renderWithProviders(<CommentThread postId={101} />, { locale: 'bn' });

    expect(await screen.findByText('এখনও কোনো কমেন্ট নেই')).toBeInTheDocument();
  });
});
