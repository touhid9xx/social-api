import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { SEARCH_MIN_TERM_LENGTH } from '@/lib/api/search';
import { renderWithProviders } from '@/lib/testing/render';
import { searchResults } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { SearchResults } from './search-results';

/**
 * `/search?q=…` — people first, then the matching posts.
 *
 * Four things are pinned, and each of them is somewhere the screen could quietly
 * go wrong:
 *
 *  - **The people block costs nothing extra.** `SearchUserHit` carries
 *    `display_name` and `avatar_url`, so a card that resolved a profile through
 *    `/users/{id}` would be one request per hit for data already in hand. The
 *    fixture's people ids (41–43) deliberately do not overlap the post authors
 *    (22–24), so the counting handler can tell the two apart.
 *  - **`users` is read from page one only.** The backend repeats the shortlist on
 *    every page; appending pages blindly would render the same people again under
 *    each loaded page of posts.
 *  - **A term below the floor fetches nothing at all.** The request could only
 *    answer `400 QUERY_TOO_SHORT`, so the screen shows the hint and stays silent —
 *    asserted with a handler that counts calls.
 *  - **Posts reuse `PostFeed`.** Paging, dedupe and the empty state come from the
 *    shared feed component, so the assertions drive its "Load more" button.
 *
 * (people কার্ডের জন্য আলাদা অনুরোধ নয়; ছোট শব্দে কোনো অনুরোধই যায় না।)
 */

const SEARCH_PATH = '*/api/v1/search';
const PROFILE_PATH = '*/api/v1/users/:user_id';

/** The people in the fixture — the ids that must never be fetched one by one. */
const PEOPLE_IDS = new Set(searchResults.users.map((user) => user.user_id));

/**
 * One served page: the matched posts, plus the cursor that follows them.
 *
 * Typed off the fixture rather than the generated schema because the fixtures are
 * built from `contracts/types.ts` while the client is typed from `types/api.d.ts`
 * — two structurally equal `PostView`s that TypeScript treats as unrelated.
 */
type SearchPage = { posts: typeof searchResults.posts; next: string | null };

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/** Count profile reads for the people hits, and keep every author name falling back. */
function countPeopleReads(): { reads: () => number } {
  let peopleReads = 0;

  server.use(
    http.get(PROFILE_PATH, ({ params }) => {
      const id = Number(params.user_id);
      if (PEOPLE_IDS.has(id)) peopleReads += 1;

      // 404 for everything: post authors then render their translated fallback,
      // which keeps the rendered names deterministic.
      return HttpResponse.json(errorBody('PROFILE_NOT_FOUND', 404, `/api/v1/users/${String(id)}`), {
        status: 404,
      });
    }),
  );

  return { reads: () => peopleReads };
}

/**
 * A people card's accessible name is the translated sentence, not the bare name —
 * so a screen reader hears where the link goes.
 */
function profileLink(scope: HTMLElement, name: string): HTMLElement {
  return within(scope).getByRole('link', { name: `View the profile of ${name}` });
}

/**
 * Serve a cursor-keyed result set that repeats `users` on every page, like the
 * backend. A cursor nobody registered answers 404 on purpose: a 4xx is never
 * retried, so a wrong cursor fails this test instead of stalling it.
 */
function servePages(pages: Record<string, SearchPage>) {
  let calls = 0;

  server.use(
    http.get(SEARCH_PATH, ({ request }) => {
      calls += 1;
      const cursor = new URL(request.url).searchParams.get('cursor') ?? 'first';
      const page = pages[cursor];

      if (!page) {
        return HttpResponse.json(errorBody('BAD_REQUEST', 400, '/api/v1/search'), { status: 400 });
      }

      return HttpResponse.json({
        query: searchResults.query,
        users: searchResults.users,
        posts: page.posts,
        next_cursor: page.next,
      });
    }),
  );

  return { calls: () => calls };
}

describe('SearchResults', () => {
  it('lists the people with their own names and links, then the posts', async () => {
    countPeopleReads();

    renderWithProviders(<SearchResults term="cursor" />);

    const people = await screen.findByRole('region', { name: 'People' });
    const posts = screen.getByRole('region', { name: 'Posts' });

    // Three hits, one per fixture row.
    expect(within(people).getAllByRole('listitem')).toHaveLength(3);

    expect(profileLink(people, 'Ayesha Rahman')).toHaveAttribute('href', '/profile/41');
    expect(profileLink(people, 'Tanvir Ahmed')).toHaveAttribute('href', '/profile/43');

    // The middle hit has no `display_name`, exactly like the backend — which
    // copies the profile value without inventing a fallback. Naming it is the
    // UI's job, so it falls back to the shared author copy.
    expect(screen.getAllByText('User 42')).toHaveLength(1);

    // The posts half is the shared feed: one card per matched post.
    const first = searchResults.posts[0];
    if (!first) throw new Error('the search fixture has no posts');

    await waitFor(() => expect(within(posts).getAllByRole('article')).toHaveLength(3));
    expect(within(posts).getByText(first.body)).toBeInTheDocument();
  });

  it('never fans out to /users/{id} for a people hit', async () => {
    const counter = countPeopleReads();

    renderWithProviders(<SearchResults term="cursor" />);

    const people = await screen.findByRole('region', { name: 'People' });
    expect(within(people).getAllByRole('listitem')).toHaveLength(3);

    // The row data is already in the envelope, so a profile request here would be
    // three extra round trips to learn nothing.
    expect(counter.reads()).toBe(0);
  });

  it('fetches nothing when the term is below the backend floor', async () => {
    const calls = servePages({ first: { posts: searchResults.posts, next: null } });
    const shortTerm = 'a'.slice(0, SEARCH_MIN_TERM_LENGTH - 1);

    renderWithProviders(<SearchResults term={shortTerm} />);

    expect(screen.getByText('Keep typing')).toBeInTheDocument();
    expect(
      screen.getByText(`Type at least ${String(SEARCH_MIN_TERM_LENGTH)} characters to search.`),
    ).toBeInTheDocument();

    // Nothing is pending, so no skeleton and no people/posts sections either.
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'People' })).not.toBeInTheDocument();
    // The whole point: a query that can only fail is never sent.
    expect(calls.calls()).toBe(0);
  });

  it('treats a whitespace-padded term as the term it trims to', async () => {
    countPeopleReads();

    renderWithProviders(<SearchResults term="  cursor  " />);

    // `"  cursor  "` trims to the same query as `"cursor"`, so it renders results
    // rather than the too-short hint.
    expect(await screen.findByRole('region', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByText('Keep typing')).not.toBeInTheDocument();
  });

  it('shows the term-specific empty state when only people match nothing', async () => {
    server.use(
      http.get(SEARCH_PATH, () =>
        HttpResponse.json({
          query: 'zzz',
          users: [],
          posts: [],
          next_cursor: null,
        }),
      ),
    );

    renderWithProviders(<SearchResults term="zzz" />);

    expect(await screen.findByText('No posts match “zzz”')).toBeInTheDocument();
    expect(screen.getByText('Try a different word, or check the spelling.')).toBeInTheDocument();

    // Nobody matched, so the people section is absent rather than empty-framed.
    expect(screen.queryByRole('region', { name: 'People' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('pages the posts and keeps the people block from repeating', async () => {
    const user = userEvent.setup();
    countPeopleReads();
    servePages({
      first: { posts: searchResults.posts.slice(0, 1), next: '1' },
      '1': { posts: searchResults.posts.slice(1, 2), next: null },
    });

    renderWithProviders(<SearchResults term="cursor" />);

    const people = await screen.findByRole('region', { name: 'People' });
    const posts = screen.getByRole('region', { name: 'Posts' });

    await waitFor(() => expect(within(posts).getAllByRole('article')).toHaveLength(1));

    await user.click(within(posts).getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(within(posts).getAllByRole('article')).toHaveLength(2));

    // The second page repeats the shortlist; reading every page would render
    // each person twice. Exactly one of each, still.
    expect(within(people).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('Ayesha Rahman')).toHaveLength(1);

    // Page two reported no cursor, so the post list is finished.
    expect(within(posts).getByText("You're all caught up.")).toBeInTheDocument();
    expect(within(posts).queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('renders under the Bangla catalog', async () => {
    countPeopleReads();

    renderWithProviders(<SearchResults term="cursor" />, { locale: 'bn' });

    expect(await screen.findByRole('region', { name: 'মানুষ' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'পোস্ট' })).toBeInTheDocument();
    // The name fallback is copy, so it is translated; real names are not.
    expect(screen.getByText('ব্যবহারকারী 42')).toBeInTheDocument();
    expect(screen.getByText('Ayesha Rahman')).toBeInTheDocument();
  });
});
