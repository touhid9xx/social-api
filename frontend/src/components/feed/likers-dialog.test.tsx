import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { LikeUser, LikeUserPage } from '@/lib/api/likes';
import { renderWithProviders } from '@/lib/testing/render';
import { postLikers, postLikersPage2 } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { LikersDialog, flattenLikerPages } from './likers-dialog';

/**
 * "Who liked this" — the read side of a like.
 *
 * What is worth pinning here is not the markup but the traffic:
 *
 *  1. A zero count renders a plain number and NO trigger — a dialog whose only
 *     content is "nobody yet" is a dead end.
 *  2. Opening is the request. The list is mounted only while the dialog is open,
 *     so a feed with a hundred cards sends nothing until one of them is pressed.
 *     A regression that hoisted `useLikers` into `LikersDialog` would show up
 *     here as a read recorded before the first click.
 *  3. The rows come from the envelope, not from a second profile read: the third
 *     fixture liker has `display_name: null`, and the fallback copy is the UI's
 *     job (`feed.authorFallback`) because the backend never invents one.
 *  4. A failed *next page* keeps the people already on screen; only a failure
 *     with nothing loaded becomes a page-level error.
 *
 * (খোলার আগে কোনো request যাবে না — এটাই এই test-এর মূল দাবি।)
 */

const LIKERS_PATH = '*/api/v1/likes/:target_type/:target_id/users';

function errorBody(error: string, status: number): ApiErrorBody {
  return {
    error,
    status,
    detail: 'test',
    path: '/api/v1/likes/post/101/users',
    request_id: 'req-1',
  };
}

/**
 * The two real pages of the fixture, plus a record of every read.
 *
 * `cursor` is recorded as the raw query value (`null` when the parameter is
 * absent) so a test can prove the first page sends none.
 */
function serveLikers() {
  const reads: Array<{ cursor: string | null; path: string }> = [];

  server.use(
    http.get(LIKERS_PATH, ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get('cursor');
      reads.push({ cursor, path: url.pathname });

      if (cursor === null) return HttpResponse.json(postLikers);
      if (cursor === postLikers.next_cursor) return HttpResponse.json(postLikersPage2);

      // Same answer the real decoder gives for a cursor it cannot parse.
      return HttpResponse.json(errorBody('INVALID_CURSOR', 400), { status: 400 });
    }),
  );

  return reads;
}

function dialog() {
  return screen.findByRole('dialog');
}

describe('LikersDialog', () => {
  it('renders an inert number when nobody has liked this', () => {
    const reads = serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={0} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(reads).toEqual([]);
  });

  it('stays quiet until the count is pressed, then lists the first page', async () => {
    const user = userEvent.setup();
    const reads = serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={3} />);

    // Nothing is fetched for a count nobody asked about.
    expect(reads).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    expect(within(panel).getByText('Liked by')).toBeInTheDocument();
    expect(within(panel).getByText('3 people liked this')).toBeInTheDocument();

    expect(await within(panel).findByRole('link', { name: 'Mahmudul Hasan' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Sadia Islam' })).toBeInTheDocument();
    // Opening is the one read, and it carries no cursor.
    expect(reads).toEqual([{ cursor: null, path: '/api/v1/likes/post/101/users' }]);
  });

  it('names a liker the backend left blank and links to their profile', async () => {
    const user = userEvent.setup();
    serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={3} />);
    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    // `feed.authorFallback` — the same fallback a comment or a post card uses.
    const blank = await within(panel).findByRole('link', { name: 'User 24' });
    expect(blank).toHaveAttribute('href', '/profile/24');

    expect(within(panel).getByRole('link', { name: 'Mahmudul Hasan' })).toHaveAttribute(
      'href',
      '/profile/22',
    );
  });

  it('follows the opaque cursor for the next page and then reports the end', async () => {
    const user = userEvent.setup();
    const reads = serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={3} />);
    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    await within(panel).findByRole('link', { name: 'Mahmudul Hasan' });

    // "That's everyone." is only correct once the last page is in.
    expect(within(panel).queryByText("That's everyone.")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Load more people' }));

    expect(await within(panel).findByRole('link', { name: 'Tanvir Ahmed' })).toBeInTheDocument();
    expect(await within(panel).findByText("That's everyone.")).toBeInTheDocument();

    // The cursor went back exactly as the server minted it.
    expect(reads).toEqual([
      { cursor: null, path: '/api/v1/likes/post/101/users' },
      { cursor: 'likers-page-2', path: '/api/v1/likes/post/101/users' },
    ]);
  });

  it('keeps the loaded people when the next page fails', async () => {
    const user = userEvent.setup();

    server.use(
      http.get(LIKERS_PATH, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor === null) return HttpResponse.json(postLikers);
        // 4xx on purpose: the client retries 5xx twice, which would make this a
        // test of TanStack's backoff rather than of the dialog. A rate limit is
        // the realistic way a page-two read fails without being our fault.
        return HttpResponse.json(errorBody('RATE_LIMITED', 429), { status: 429 });
      }),
    );

    renderWithProviders(<LikersDialog targetType="comment" targetId={55} count={3} />);
    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    await within(panel).findByRole('link', { name: 'Mahmudul Hasan' });

    await user.click(within(panel).getByRole('button', { name: 'Load more people' }));

    expect(await within(panel).findByText("Couldn't load more people. Try again.")).toBeVisible();
    // The first page is still on screen and no page-level error replaced it.
    expect(within(panel).getByRole('link', { name: 'Mahmudul Hasan' })).toBeInTheDocument();
    expect(within(panel).queryByText("Couldn't load this list")).not.toBeInTheDocument();
  });

  it('shows a page-level error when nothing loaded, and recovers on retry', async () => {
    const user = userEvent.setup();

    // The first read fails, every later one succeeds — so the retry button has
    // something to prove. (`serveLikers` is deliberately not used: this handler
    // has to own the counter, and MSW answers with the last registered match.)
    let calls = 0;
    server.use(
      http.get(LIKERS_PATH, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(errorBody('RATE_LIMITED', 429), { status: 429 })
          : HttpResponse.json(postLikers);
      }),
    );

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={3} />);
    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    expect(await within(panel).findByText("Couldn't load this list")).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Try again' }));

    expect(await within(panel).findByRole('link', { name: 'Mahmudul Hasan' })).toBeInTheDocument();
    expect(within(panel).queryByText("Couldn't load this list")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('reads the comment endpoint for a comment target', async () => {
    const user = userEvent.setup();
    const reads = serveLikers();

    renderWithProviders(<LikersDialog targetType="comment" targetId={55} count={3} />);
    await user.click(screen.getByRole('button', { name: 'See the 3 people who liked this' }));

    const panel = await dialog();
    await within(panel).findByRole('link', { name: 'Mahmudul Hasan' });

    // The target type is a path segment, not a body field — a mistake here 200s
    // with an empty page, so it has to be asserted.
    expect(reads).toEqual([{ cursor: null, path: '/api/v1/likes/comment/55/users' }]);
  });

  it('uses the singular copy for a single liker', async () => {
    const user = userEvent.setup();
    serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={1} />);
    await user.click(screen.getByRole('button', { name: 'See the person who liked this' }));

    const panel = await dialog();
    expect(within(panel).getByText('1 person liked this')).toBeInTheDocument();
  });

  it('is translated', async () => {
    const user = userEvent.setup();
    serveLikers();

    renderWithProviders(<LikersDialog targetType="post" targetId={101} count={3} />, {
      locale: 'bn',
    });

    await user.click(screen.getByRole('button', { name: 'যাঁরা লাইক করেছেন (3 জন) তাঁদের দেখুন' }));

    const panel = await dialog();
    expect(within(panel).getByText('লাইক করেছেন')).toBeInTheDocument();
    expect(await within(panel).findByRole('link', { name: 'Mahmudul Hasan' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'আরও মানুষ দেখুন' })).toBeInTheDocument();
  });
});

describe('flattenLikerPages', () => {
  it('drops a person who appears on two consecutive pages', () => {
    const repeated: LikeUser = { user_id: 23, display_name: 'Sadia Islam', avatar_url: null };
    const pages: LikeUserPage[] = [
      { items: [postLikers.items[0]!, repeated], next_cursor: 'likers-page-2' },
      // A like removed mid-read shifts the cursor window, so the same id can be
      // served twice; React keys would collide without this.
      { items: [repeated, postLikersPage2.items[0]!], next_cursor: null },
    ];

    expect(flattenLikerPages(pages).map((user) => user.user_id)).toEqual([22, 23, 25]);
  });
});
