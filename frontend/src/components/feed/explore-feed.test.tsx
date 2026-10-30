import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ExploreFeedPage, FeedPost } from '@/lib/api/feed';
import { renderWithProviders } from '@/lib/testing/render';
import { exploreFeedPosts, homeFeedPosts } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { ExploreFeed } from './explore-feed';

/**
 * The discovery feed.
 *
 * The component is `PostFeed` plus copy, so what is worth pinning is not the
 * pagination mechanics — `post-feed` has them through `HomeFeed`'s suite — but
 * the three things that make THIS feed different:
 *  - it reads the explore endpoint, and only that one;
 *  - it has no composer, because writing belongs on `/home`;
 *  - its empty copy says "nothing to discover", not "follow someone".
 *
 * (এক্সপ্লোর আলাদা endpoint পড়ে, কম্পোজার নেই, খালি অবস্থার বার্তাও আলাদা।)
 */

const EXPLORE_PATH = '/api/v1/feed/explore';
const HOME_PATH = '/api/v1/feed/home';

type Page = { items: FeedPost[]; next: string | null };

function post(id: number): FeedPost {
  const found = exploreFeedPosts.find((item) => item.id === id);
  if (!found) throw new Error(`fixture explore post ${String(id)} is missing`);
  // The hand-mirrored contract types `visibility` as a bare `string` and the two
  // flags as optional; the OpenAPI schema the feed is typed from narrows and
  // enforces all three.
  return {
    ...found,
    visibility: found.visibility as FeedPost['visibility'],
    is_edited: found.is_edited ?? false,
    is_liked_by_me: found.is_liked_by_me ?? false,
  };
}

const ERROR_BODY: ApiErrorBody = {
  error: 'FEED_UNAVAILABLE',
  status: 404,
  detail: 'test',
  path: EXPLORE_PATH,
  request_id: 'test-request-id',
};

/** Serve a cursor-keyed explore feed; a missing cursor is a 404 (never retried). */
function serveExplore(pages: Record<string, Page>) {
  server.use(
    http.get(`*${EXPLORE_PATH}`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor') ?? 'first';
      const page = pages[cursor];

      if (!page) return HttpResponse.json(ERROR_BODY, { status: ERROR_BODY.status });

      const body: ExploreFeedPage = {
        items: page.items,
        next_cursor: page.next,
        cache_hit: false,
      };
      return HttpResponse.json(body);
    }),
  );
}

describe('ExploreFeed', () => {
  it('renders the discovery corpus, not the home feed', async () => {
    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText(post(201).body)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(exploreFeedPosts.length);

    // The two fixture sets are disjoint on purpose: seeing a home-feed post here
    // would mean the component read the wrong endpoint.
    for (const homePost of homeFeedPosts) {
      expect(screen.queryByText(homePost.body)).toBeNull();
    }
  });

  it('never requests the home feed', async () => {
    const requested: string[] = [];
    server.use(
      http.get(`*${HOME_PATH}`, () => {
        requested.push(HOME_PATH);
        return HttpResponse.json({ items: [], next_cursor: null, cache_hit: false });
      }),
      http.get(`*${EXPLORE_PATH}`, () => {
        requested.push(EXPLORE_PATH);
        return HttpResponse.json({ items: [post(201)], next_cursor: null, cache_hit: false });
      }),
    );

    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText(post(201).body)).toBeInTheDocument();
    expect(requested).toEqual([EXPLORE_PATH]);
  });

  it('appends the next page when "Load more" is pressed', async () => {
    serveExplore({
      first: { items: [post(201)], next: 'c1' },
      c1: { items: [post(202)], next: null },
    });

    const user = userEvent.setup();
    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText(post(201).body)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText(post(202).body)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });

  it('has no composer — writing belongs on the home feed', async () => {
    serveExplore({ first: { items: [post(201)], next: null } });

    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText(post(201).body)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
  });

  it('shows explore-specific empty copy', async () => {
    serveExplore({ first: { items: [], next: null } });

    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText('Nothing to explore yet')).toBeInTheDocument();
    // The home feed tells the user to follow people; that advice is wrong here.
    expect(screen.queryByText('Follow a few people and their posts will show up here.')).toBeNull();
  });

  it('reports a load-more failure without losing the first page', async () => {
    serveExplore({ first: { items: [post(201)], next: 'c1' } });

    const user = userEvent.setup();
    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByText(post(201).body)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText("Couldn't load more posts. Try again.")).toBeInTheDocument();
    expect(screen.getByText(post(201).body)).toBeInTheDocument();
  });

  it('shows a page-level error when nothing loaded at all', async () => {
    serveExplore({});

    renderWithProviders(<ExploreFeed />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your feed")).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    serveExplore({ first: { items: [], next: null } });

    renderWithProviders(<ExploreFeed />, { locale: 'bn' });

    expect(await screen.findByText('এখনও দেখার মতো কিছু নেই')).toBeInTheDocument();
  });
});
