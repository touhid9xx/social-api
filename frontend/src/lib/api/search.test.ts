import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { homeFeedPosts, searchResults } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { AppApiError } from './errors';
import { SEARCH_MIN_TERM_LENGTH, searchContent } from './search';

/**
 * The search client — `GET /api/v1/search`.
 *
 * The endpoint is the odd one out in the contract, so the facts pinned here are
 * the ones a caller cannot recover from if they drift:
 *
 *  - the parameter is `q`, not `term`/`query`/`search` — a typo answers 422, not
 *    an empty list, so it would look like a data problem;
 *  - the term travels trimmed, because the backend trims for matching anyway and
 *    a leading space would otherwise make `" ab"` and `"ab"` two cache entries;
 *  - the first page sends NO cursor, and an opaque one round-trips untouched;
 *  - the envelope is `{ query, users, posts, next_cursor }` — two result kinds in
 *    one body, with `next_cursor` paging posts only;
 *  - `400 QUERY_TOO_SHORT` is a real answer, so it has to settle into an
 *    `AppApiError` in one request rather than a retry.
 *
 * (শব্দটি `q` নামেই যায়, ট্রিম হয়ে; প্রথম পাতায় cursor যায় না।)
 */

const SEARCH_PATH = '*/api/v1/search';

function errorBody(error: string, status: number, path: string, detail: unknown): ApiErrorBody {
  return { error, status, detail, path, request_id: 'req-1' };
}

describe('searchContent', () => {
  it('returns both result kinds from the shared fixture', async () => {
    const results = await searchContent({ term: 'cursor' });

    // The people shortlist and the posts travel together; dropping either half
    // would still type-check, so both are asserted.
    expect(results.users.map((user) => user.user_id)).toEqual(
      searchResults.users.map((user) => user.user_id),
    );
    expect(results.posts.map((post) => post.id)).toEqual(homeFeedPosts.map((post) => post.id));
    // Three posts is the whole result set, so the backend reports no next page.
    expect(results.next_cursor).toBeNull();
  });

  it('sends the term as `q`, trimmed, with the default page size', async () => {
    let search = '';
    server.use(
      http.get(SEARCH_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ query: '', users: [], posts: [], next_cursor: null });
      }),
    );

    await searchContent({ term: '  cursor  ' });

    const params = new URLSearchParams(search);
    // `q` is the contract name; the padding must not reach the wire, or the
    // backend's own trim would be the only thing making the two spellings equal.
    expect(params.get('q')).toBe('cursor');
    expect(params.get('limit')).toBe(String(DEFAULT_PAGE_SIZE));
    // The client defaults `cursor` to `null`; forwarding that literal would send
    // the string "null" and the backend would reject it as an invalid cursor.
    expect(params.has('cursor')).toBe(false);
  });

  it('sends only the three parameters the endpoint accepts', async () => {
    let search = '';
    server.use(
      http.get(SEARCH_PATH, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ query: '', users: [], posts: [], next_cursor: null });
      }),
    );

    await searchContent({ term: 'cursor', cursor: '2', limit: 5 });

    // The route declares no result-kind or visibility filter — visibility is a
    // server-side decision — so a stray parameter would be a caller inventing a
    // contract that does not exist.
    expect([...new URLSearchParams(search).keys()].sort()).toEqual(['cursor', 'limit', 'q']);
  });

  it('passes an opaque cursor back verbatim and pages posts only', async () => {
    const results = await searchContent({ term: 'cursor', cursor: '1', limit: 1 });

    // The fixture holds three posts, so starting at offset 1 must skip the first.
    expect(results.posts.map((post) => post.id)).toEqual([homeFeedPosts[1]?.id]);
    expect(results.next_cursor).toBe('2');
    // `next_cursor` pages the posts. The people shortlist is capped server-side
    // and repeated on every page, so it must still be complete here — a caller
    // that assumed otherwise would blank the people block while paging.
    expect(results.users).toHaveLength(searchResults.users.length);
  });

  it('accepts a term of exactly the minimum length and refuses one shorter', async () => {
    const atFloor = 'ab'.slice(0, SEARCH_MIN_TERM_LENGTH);
    const belowFloor = atFloor.slice(0, SEARCH_MIN_TERM_LENGTH - 1);

    await expect(searchContent({ term: atFloor })).resolves.toBeTruthy();

    const error = await searchContent({ term: belowFloor }).catch((thrown: unknown) => thrown);

    // Ties the client constant to the floor the server actually enforces: if
    // either side moves alone, `useSearch` starts firing requests that can only
    // answer 400 (or stops firing ones that would have worked).
    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    expect(error.status).toBe(400);
    expect(error.detail).toMatchObject({ code: 'QUERY_TOO_SHORT' });
  });

  it('normalises a too-short refusal into a non-transient AppApiError', async () => {
    server.use(
      http.get(SEARCH_PATH, () =>
        HttpResponse.json(
          errorBody('BAD_REQUEST', 400, '/api/v1/search', {
            code: 'QUERY_TOO_SHORT',
            min_length: SEARCH_MIN_TERM_LENGTH,
          }),
          { status: 400 },
        ),
      ),
    );

    const error = await searchContent({ term: 'abc' }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppApiError);
    if (!(error instanceof AppApiError)) throw error;
    // The envelope's `error` is the generic class; the specific reason rides in
    // `detail.code`, which is the field a caller has to read.
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.status).toBe(400);
    expect(error.path).toBe('/api/v1/search');
    expect(error.isClientError).toBe(true);
    expect(error.isTransient).toBe(false);
  });
});
