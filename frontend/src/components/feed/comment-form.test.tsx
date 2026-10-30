import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { CommentCreateBody, CommentView } from '@/lib/api/comments';
import { IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';
import { renderWithProviders } from '@/lib/testing/render';
import { FIXTURE_NOW } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { CommentForm } from './comment-form';

/**
 * The comment form, in both of its shapes.
 *
 * One component serves "comment on the post" and "reply to this comment" because
 * `CommentCreate` carries exactly one differing field — `parent_id`. These tests
 * pin that: the same draft rules, the same idempotency key, and a `parent_id`
 * that is `null` for a new comment and the parent's id for a reply.
 *
 * A blank or whitespace-only draft must never reach the network: `commentSchema`
 * trims before the `min(1)` check, so the 422 the backend would return is a
 * request nobody needed to spend.
 *
 * The success signal asserted here is the `role="status"` line — the toast lives
 * in the root layout's `Toaster`, which `renderWithProviders` does not mount.
 *
 * (উত্তর আর নতুন কমেন্ট — একই form, শুধু parent_id আলাদা।)
 */

const COMMENTS_PATH = '*/api/v1/posts/:post_id/comments';

/** Count requests and echo back a contract-shaped `CommentView`. */
function capture() {
  const seen: { calls: number; body?: CommentCreateBody; key?: string | null } = { calls: 0 };

  server.use(
    http.post(COMMENTS_PATH, async ({ request }) => {
      seen.calls += 1;
      seen.body = (await request.json()) as CommentCreateBody;
      seen.key = request.headers.get(IDEMPOTENCY_HEADER);

      const created: CommentView = {
        id: 951,
        post_id: 101,
        author_id: 21,
        parent_id: seen.body.parent_id ?? null,
        depth: seen.body.parent_id ? 1 : 0,
        body: seen.body.body,
        like_count: 0,
        created_at: FIXTURE_NOW,
        updated_at: FIXTURE_NOW,
        is_liked_by_me: false,
        is_edited: false,
      };

      return HttpResponse.json(created, { status: 201 });
    }),
  );

  return seen;
}

describe('CommentForm', () => {
  it('renders a new-comment form', () => {
    renderWithProviders(<CommentForm postId={101} />);

    expect(screen.getByRole('form', { name: 'Write a comment' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comment')).toHaveAttribute('maxlength', '2000');
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    // No cancel button: a new comment has nothing to cancel.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('counts down the remaining characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommentForm postId={101} />);

    // ICU formats `#` with the locale's number style, so the count is grouped.
    expect(screen.getByText('2,000 characters left')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Comment'), 'Hello');

    expect(screen.getByText('1,995 characters left')).toBeInTheDocument();
  });

  it('refuses an empty draft without calling the API', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<CommentForm postId={101} />);

    await user.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Write something before commenting.')).toBeInTheDocument();
    expect(seen.calls).toBe(0);
  });

  it('treats a whitespace-only draft as empty', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<CommentForm postId={101} />);

    await user.type(screen.getByLabelText('Comment'), '    ');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    expect(await screen.findByText('Write something before commenting.')).toBeInTheDocument();
    expect(seen.calls).toBe(0);
  });

  it('posts the trimmed body with a fresh idempotency key, then clears itself', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<CommentForm postId={101} />);

    await user.type(screen.getByLabelText('Comment'), '  Thoughtful reply  ');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(seen.calls).toBe(1));
    // Trimmed by the schema, not by a server round trip.
    expect(seen.body).toEqual({ body: 'Thoughtful reply', parent_id: null });
    // A retried submit must resolve to the first comment, not a duplicate.
    expect(seen.key).toMatch(/^[\w-]{8,128}$/);

    await waitFor(() => expect(screen.getByLabelText('Comment')).toHaveValue(''));
    expect(screen.getByRole('status')).toHaveTextContent('Comment posted');
  });

  it('sends the parent id when replying and closes itself through onDone', async () => {
    const user = userEvent.setup();
    const seen = capture();
    const onDone = vi.fn();
    renderWithProviders(
      <CommentForm postId={101} parentId={501} replyingTo="Alice" onDone={onDone} />,
    );

    expect(screen.getByRole('form', { name: 'Reply to Alice' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your reply')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Your reply'), 'Same here.');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));

    await waitFor(() => expect(seen.calls).toBe(1));
    expect(seen.body).toEqual({ body: 'Same here.', parent_id: 501 });
    expect(screen.getByRole('status')).toHaveTextContent('Reply posted');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('closes a reply without submitting when cancelled', async () => {
    const user = userEvent.setup();
    const seen = capture();
    const onDone = vi.fn();
    renderWithProviders(<CommentForm postId={101} parentId={501} onDone={onDone} />);

    await user.type(screen.getByLabelText('Your reply'), 'never mind');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(seen.calls).toBe(0);
  });

  it('keeps the draft and surfaces the shared message when the API rejects it', async () => {
    const user = userEvent.setup();
    const body: ApiErrorBody = {
      error: 'VALIDATION_ERROR',
      status: 422,
      detail: 'body must not be empty',
      path: '/api/v1/posts/101/comments',
      request_id: 'test-request-id',
    };
    server.use(http.post(COMMENTS_PATH, () => HttpResponse.json(body, { status: body.status })));

    renderWithProviders(<CommentForm postId={101} />);

    await user.type(screen.getByLabelText('Comment'), 'Hello thread');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    // 422 -> errors.validationError, never the raw code.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please check the highlighted fields and try again.',
    );
    // A failed comment must not eat what the user wrote.
    expect(screen.getByLabelText('Comment')).toHaveValue('Hello thread');
  });

  it('renders Bangla copy under the bn locale', () => {
    renderWithProviders(<CommentForm postId={101} />, { locale: 'bn' });

    expect(screen.getByRole('form', { name: 'একটি কমেন্ট লিখুন' })).toBeInTheDocument();
    expect(screen.getByLabelText('কমেন্ট')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'কমেন্ট করুন' })).toBeInTheDocument();
    expect(screen.getByText(/অক্ষর বাকি/)).toBeInTheDocument();
  });
});
