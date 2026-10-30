import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { FeedPost, HomeFeedPage } from '@/lib/api/feed';
import { renderWithProviders } from '@/lib/testing/render';
import { homeFeedPosts } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { HomeFeed } from './home-feed';

/**
 * The like control.
 *
 * The button renders the count and the `aria-pressed` state from the POST IN THE
 * QUERY CACHE, not from a local copy — that is the whole point of the optimistic
 * design (one source of truth, so the number can never drift from
 * `is_liked_by_me`). A component test that passed `count` as a prop therefore
 * could not observe an optimistic update at all, so these tests drive the card
 * through the feed, which is the nearest component that subscribes to that
 * cache.
 *
 * Asserted here: the state is exposed as `aria-pressed`, the count moves by one
 * immediately, only the clicked card changes, and a failed request rolls the
 * count back. The failure toast is NOT asserted — the `Toaster` lives in the
 * root layout and is not mounted by `renderWithProviders`.
 *
 * (লাইক ব্যর্থ হলে count আগের জায়গায় ফিরে যায় — cache rollback।)
 */

const FEED_PATH = '/api/v1/feed/home';
const LIKES_PATH = '*/api/v1/likes/:target_type/:target_id';

function post(id: number, overrides: Partial<FeedPost> = {}): FeedPost {
  const found = homeFeedPosts.find((item) => item.id === id);
  if (!found) throw new Error(`fixture post ${String(id)} is missing`);
  // See post-card.test.tsx: the hand-mirrored contract leaves `visibility` a
  // bare string and the two flags optional.
  return {
    ...found,
    visibility: found.visibility as FeedPost['visibility'],
    is_edited: found.is_edited ?? false,
    is_liked_by_me: found.is_liked_by_me ?? false,
    ...overrides,
  };
}

function serveFeed(items: FeedPost[]) {
  server.use(
    http.get(`*${FEED_PATH}`, () => {
      const body: HomeFeedPage = { items, next_cursor: null, cache_hit: false };
      return HttpResponse.json(body);
    }),
  );
}

/** Post 101 is unliked with 12 likes; post 102 is already liked with 4. */
async function openFeed(items: FeedPost[] = [post(101)]) {
  serveFeed(items);
  renderWithProviders(<HomeFeed />);

  const [first] = items;
  if (!first) throw new Error('openFeed needs at least one post');
  await screen.findByText(first.body);
}

describe('LikeButton', () => {
  it('exposes the like state and count as a stateful button', async () => {
    await openFeed();

    const like = screen.getByRole('button', { name: '12 Like' });

    expect(like).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the already-liked state of a post the user has liked', async () => {
    await openFeed([post(102)]);

    const unlike = screen.getByRole('button', { name: '4 Unlike' });

    expect(unlike).toHaveAttribute('aria-pressed', 'true');
  });

  it('increments the count optimistically before the request resolves', async () => {
    const user = userEvent.setup();
    await openFeed();

    await user.click(screen.getByRole('button', { name: '12 Like' }));

    // No `waitFor` around the count: the patch lands in the cache in
    // `onMutate`, so the very next render already shows 13.
    expect(await screen.findByRole('button', { name: '13 Unlike' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('decrements the count when unliking', async () => {
    const user = userEvent.setup();
    await openFeed([post(102)]);

    await user.click(screen.getByRole('button', { name: '4 Unlike' }));

    expect(await screen.findByRole('button', { name: '3 Like' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('posts to the like endpoint and deletes on unlike', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    server.use(
      http.post(LIKES_PATH, ({ request }) => {
        seen.push(`POST ${new URL(request.url).pathname}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(LIKES_PATH, ({ request }) => {
        seen.push(`DELETE ${new URL(request.url).pathname}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await openFeed([post(101), post(102)]);

    await user.click(screen.getByRole('button', { name: '12 Like' }));
    await screen.findByRole('button', { name: '13 Unlike' });

    await user.click(screen.getByRole('button', { name: '4 Unlike' }));
    await screen.findByRole('button', { name: '3 Like' });

    expect(seen).toEqual(['POST /api/v1/likes/post/101', 'DELETE /api/v1/likes/post/102']);
  });

  it('leaves the other cards alone', async () => {
    const user = userEvent.setup();
    await openFeed([post(101), post(102)]);

    await user.click(screen.getByRole('button', { name: '12 Like' }));

    // The patch is keyed by post id; a prefix-wide `setQueriesData` must not
    // touch a card it was not asked about.
    expect(await screen.findByRole('button', { name: '13 Unlike' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 Unlike' })).toBeInTheDocument();
  });

  it('rolls the count back when the request fails', async () => {
    const user = userEvent.setup();
    const body: ApiErrorBody = {
      error: 'SERVICE_UNAVAILABLE',
      status: 500,
      detail: 'test',
      path: '/api/v1/likes/post/101',
      request_id: 'test-request-id',
    };
    // A 5xx is retried for QUERIES but never for mutations, so this fails once
    // and the rollback is immediate.
    server.use(http.post(LIKES_PATH, () => HttpResponse.json(body, { status: body.status })));
    await openFeed();

    await user.click(screen.getByRole('button', { name: '12 Like' }));

    const rolledBack = await screen.findByRole('button', { name: '12 Like' });
    await waitFor(() => expect(rolledBack).toBeEnabled());
    expect(rolledBack).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders Bangla copy and Bangla numerals under the bn locale', async () => {
    serveFeed([post(101)]);
    renderWithProviders(<HomeFeed />, { locale: 'bn' });
    await screen.findByText(post(101).body);

    // The action word is the accessible name; the count is locale-formatted.
    const like = screen.getByRole('button', { name: '১২ লাইক করুন' });

    expect(like).toHaveAttribute('aria-pressed', 'false');
  });
});
