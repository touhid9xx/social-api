import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/lib/testing/render';
import { homeFeedPosts, postComments } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { PostDetail } from './post-detail';

/**
 * The post detail route.
 *
 * The post is read from `GET /posts/{id}`, not from the feed cache: a shared
 * link has no feed, so a cold fetch is the only path that always works. The
 * thread comes from the comment endpoint that already inlines first-level
 * replies, which is why the UI renders exactly two levels.
 *
 * Two failure modes are distinguished on purpose. A 404 is final — retrying can
 * only produce the same 404, and `PostView` also answers 404 for posts the
 * reader may not see, so the two cases are indistinguishable by design. Anything
 * else is retryable, and the retry is a real read.
 *
 * A 429 is used for the retryable case rather than a 5xx: the shared client
 * retries 5xx twice with backoff, which would make the test wait on the backoff
 * rather than on the component.
 *
 * (404 মানে "আর চেষ্টা করে লাভ নেই" — বাকি ব্যর্থতা আবার চেষ্টা করার মতো।)
 */

const POST_PATH = '*/api/v1/posts/:post_id';
const COMMENTS_PATH = '*/api/v1/posts/:post_id/comments';

/** Post 101 is the one fixture post that carries a thread. */
const POST_BODY = homeFeedPosts[0]?.body ?? '';

describe('PostDetail', () => {
  it('renders the post, its author, and the two-level thread', async () => {
    renderWithProviders(<PostDetail postId={101} />);

    expect(await screen.findByText(POST_BODY)).toBeInTheDocument();
    // Author 22 wrote both the post and its inline reply, so the name is shared.
    expect((await screen.findAllByText('Alice Rahman')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to feed' })).toBeInTheDocument();

    // Top-level comments.
    expect(
      await screen.findByText(postComments[0]?.body ?? 'missing fixture body'),
    ).toBeInTheDocument();
    expect(screen.getByText(postComments[1]?.body ?? 'missing fixture body')).toBeInTheDocument();
    // …and the inline reply, which is serialised inside its parent.
    expect(screen.getByText('Glad it landed.')).toBeInTheDocument();
  });

  it('reports the post’s own comment count', async () => {
    renderWithProviders(<PostDetail postId={101} />);

    // The card shows the same `comment_count` the thread fixture sums to, so a
    // detail page and a feed card cannot disagree.
    expect(await screen.findByText('3 comments')).toBeInTheDocument();
  });

  it('offers the comment form even while the thread is still loading', async () => {
    // The composer sits outside the thread's branches: a failed or slow thread
    // must not take the ability to comment down with it.
    server.use(http.get(COMMENTS_PATH, () => HttpResponse.json({ items: [], next_cursor: null })));

    renderWithProviders(<PostDetail postId={101} />);

    expect(await screen.findByRole('form', { name: 'Write a comment' })).toBeInTheDocument();
  });

  it('renders a missing post as not found, without a retry', async () => {
    renderWithProviders(<PostDetail postId={999} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Post not found');
    expect(
      screen.getByText('It may have been deleted, or it may not be visible to you.'),
    ).toBeInTheDocument();
    // Retrying a 404 can only produce the same 404.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('renders a transient failure with a retry that recovers', async () => {
    let attempt = 0;
    const body: ApiErrorBody = {
      error: 'RATE_LIMITED',
      status: 429,
      detail: 'test',
      path: '/api/v1/posts/101',
      request_id: 'test-request-id',
    };

    server.use(
      http.get(POST_PATH, () => {
        attempt += 1;
        if (attempt === 1) return HttpResponse.json(body, { status: body.status });
        return HttpResponse.json(homeFeedPosts[0]);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<PostDetail postId={101} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this post");

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(POST_BODY)).toBeInTheDocument();
  });

  it('increments the post’s comment count after a comment is posted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostDetail postId={101} />);

    expect(await screen.findByText('3 comments')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Comment'), 'Adding my two cents');
    await user.click(screen.getByRole('button', { name: 'Comment' }));

    // The count is known exactly (+1), so it is patched in the cache rather than
    // refetched — a refetch would also reset the reader's scroll position.
    expect(await screen.findByText('4 comments')).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderWithProviders(<PostDetail postId={101} />, { locale: 'bn' });

    expect(await screen.findByText(POST_BODY)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ফিডে ফিরুন' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'কমেন্ট' })).toBeInTheDocument();
  });
});
