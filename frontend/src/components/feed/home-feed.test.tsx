import { screen } from '@testing-library/react';
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
 * The endless feed.
 *
 * jsdom has no IntersectionObserver, so every assertion here drives the same
 * code path a keyboard user takes: the explicit "Load more" button. That is not
 * a test shortcut — it is the accessibility guarantee the component makes.
 *
 * (sentinel নয়, বাটন — কীবোর্ড ব্যবহারকারীও এভাবেই পরের পাতা আনেন।)
 */

const FEED_PATH = '/api/v1/feed/home';

type Page = { items: FeedPost[]; next: string | null };

function post(id: number): FeedPost {
  const found = homeFeedPosts.find((item) => item.id === id);
  if (!found) throw new Error(`fixture post ${String(id)} is missing`);
  // The hand-mirrored contract types `visibility` and `media[].kind` as bare
  // `string`s and the two flags as optional; the OpenAPI schema the feed is
  // typed from narrows and enforces all of them.
  return {
    ...found,
    visibility: found.visibility as FeedPost['visibility'],
    media: found.media as FeedPost['media'],
    is_edited: found.is_edited ?? false,
    is_liked_by_me: found.is_liked_by_me ?? false,
  };
}

const ERROR_BODY: ApiErrorBody = {
  error: 'FEED_UNAVAILABLE',
  status: 404,
  detail: 'test',
  path: FEED_PATH,
  request_id: 'test-request-id',
};

/**
 * Serve a cursor-keyed feed. Missing cursors answer 404 on purpose: that is how
 * the "load more failed" path is reached without waiting for retries — a 4xx is
 * never retried, a 5xx would be.
 */
function serveFeed(pages: Record<string, Page>) {
  server.use(
    http.get(`*${FEED_PATH}`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor') ?? 'first';
      const page = pages[cursor];

      if (!page) {
        return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });
      }

      const body: HomeFeedPage = { items: page.items, next_cursor: page.next, cache_hit: false };
      return HttpResponse.json(body);
    }),
  );
}

describe('HomeFeed', () => {
  // Posts are counted by role "article" (PostCard's root element), not
  // "listitem": a card's media grid is itself a <ul>/<li>, so counting list
  // items would count attachments as posts.
  it('renders the first page and ends the feed when there is no cursor', async () => {
    serveFeed({ first: { items: [post(101), post(102), post(103)], next: null } });

    renderWithProviders(<HomeFeed />);

    expect(await screen.findByText(post(101).body)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('appends the next page when "Load more" is pressed', async () => {
    serveFeed({
      first: { items: [post(101)], next: 'c1' },
      c1: { items: [post(102)], next: null },
    });

    const user = userEvent.setup();
    renderWithProviders(<HomeFeed />);

    expect(await screen.findByText(post(101).body)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText(post(102).body)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it('drops a post that arrives on two consecutive pages', async () => {
    // Cursor pagination is not order-stable under concurrent writes: a post
    // inserted while the user scrolls can appear on both pages.
    serveFeed({
      first: { items: [post(101), post(102)], next: 'c1' },
      c1: { items: [post(102), post(103)], next: null },
    });

    const user = userEvent.setup();
    renderWithProviders(<HomeFeed />);

    expect(await screen.findByText(post(102).body)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText(post(103).body)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('shows the empty state for an empty feed', async () => {
    serveFeed({ first: { items: [], next: null } });

    renderWithProviders(<HomeFeed />);

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows an error whose retry recovers the feed', async () => {
    let attempt = 0;
    server.use(
      http.get(`*${FEED_PATH}`, () => {
        attempt += 1;
        if (attempt === 1) return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });

        const body: HomeFeedPage = {
          items: [post(101)],
          next_cursor: null,
          cache_hit: false,
        };
        return HttpResponse.json(body);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<HomeFeed />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your feed")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(post(101).body)).toBeInTheDocument();
  });

  it('reports a failed load-more without losing the posts already shown', async () => {
    serveFeed({ first: { items: [post(101)], next: 'c1' } });

    const user = userEvent.setup();
    renderWithProviders(<HomeFeed />);

    expect(await screen.findByText(post(101).body)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText("Couldn't load more posts. Try again.")).toBeInTheDocument();
    expect(screen.getByText(post(101).body)).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    serveFeed({ first: { items: [], next: null } });

    renderWithProviders(<HomeFeed />, { locale: 'bn' });

    expect(await screen.findByText('এখনও কিছু নেই')).toBeInTheDocument();
  });
});
