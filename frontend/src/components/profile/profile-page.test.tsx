import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens } from '@/lib/api';
import { renderWithProviders } from '@/lib/testing/render';
import { authorPosts } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { ProfilePage } from './profile-page';

// The header mounts `MessageButton`, which calls `useRouter()`. With no App
// Router mounted that invariant throws and takes the whole page down with it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

/**
 * `/profile/[id]`.
 *
 * Two independent reads sit on this screen — the profile and that author's
 * posts — and the relationship between them is the point of most of these
 * tests:
 *
 *  - the posts list is mounted ONLY after the profile resolved, so a 404 never
 *    produces a second, misleading error for the same cause;
 *  - a 404 or 403 has no retry button, because retrying can only repeat the
 *    answer, while a 5xx does have one;
 *  - the posts come from `GET /posts/by-author/{id}` (ids 401+), never from a
 *    cached feed that happens to contain the same author.
 *
 * (প্রোফাইল না মিললে পোস্টের জন্য আলাদা রিকোয়েস্ট যায় না; 404/403-এ retry নেই।)
 */

const PROFILE_PATH = '*/api/v1/users/:user_id';
const AUTHOR_POSTS_PATH = '*/api/v1/posts/by-author/:author_id';

function errorBody(error: string, status: number, path: string): ApiErrorBody {
  return { error, status, detail: 'test', path, request_id: 'req-1' };
}

/** Fixture lookup that fails loudly instead of rendering an empty assertion. */
function bodyOf(userId: number, index: number): string {
  const post = authorPosts[userId]?.[index];
  if (!post) throw new Error(`authorPosts[${String(userId)}][${String(index)}] is missing`);
  return post.body;
}

beforeEach(() => {
  clearTokens();
});

describe('ProfilePage', () => {
  it('renders the profile, its counts and its posts', async () => {
    renderWithProviders(<ProfilePage userId={22} />);

    // Identity first: this is who the page claims to be about.
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Rahman' })).toBeVisible();
    expect(screen.getByText('Writes about feeds.')).toBeVisible();
    expect(screen.getByText('Chattogram')).toBeVisible();

    // Counts come from `follow-counts`, and they are LINKS even when zero — the
    // list is a real page, not a label.
    // (`findBy`, because the counts are a second read that resolves after the
    // profile itself — before it lands both links read "0".)
    expect(await screen.findByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      '/profile/22/followers',
    );
    expect(await screen.findByRole('link', { name: '7' })).toHaveAttribute(
      'href',
      '/profile/22/following',
    );

    // Posts come from the by-author endpoint (ids 401–402 for Alice)…
    expect(await screen.findByText(bodyOf(22, 0))).toBeVisible();
    expect(screen.getByText(bodyOf(22, 1))).toBeVisible();

    // …and nothing from another author's page.
    expect(screen.queryByText(bodyOf(23, 0))).toBeNull();
  });

  it('does not mount the posts list until the profile resolves', () => {
    const requested: string[] = [];
    server.use(
      http.get(AUTHOR_POSTS_PATH, ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
    );

    renderWithProviders(<ProfilePage userId={22} />);

    // Synchronously after render the profile query is still pending, so the
    // posts query does not exist yet — a hook cannot be conditional, which is
    // why the list lives in its own component.
    expect(requested).toEqual([]);
  });

  it('shows a 404 without a retry button, and never asks for posts', async () => {
    const requested: string[] = [];
    server.use(
      http.get(AUTHOR_POSTS_PATH, ({ request }) => {
        requested.push(new URL(request.url).pathname);
        return HttpResponse.json({ items: [], next_cursor: null });
      }),
      http.get(PROFILE_PATH, () =>
        HttpResponse.json(errorBody('PROFILE_NOT_FOUND', 404, '/api/v1/users/999'), {
          status: 404,
        }),
      ),
    );

    renderWithProviders(<ProfilePage userId={999} />);

    expect(await screen.findByRole('heading', { name: 'Profile not found' })).toBeVisible();
    expect(screen.getByText(/may have been deleted/)).toBeVisible();

    // Retrying a 404 can only return a 404.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    // And the second read must not fire for a user the backend already denied:
    // "no posts" would be a second, wrong explanation for one cause.
    await waitFor(() => expect(requested).toEqual([]));
  });

  it('shows a 403 as a private profile, again without a retry', async () => {
    server.use(
      http.get(PROFILE_PATH, () =>
        HttpResponse.json(errorBody('PROFILE_NOT_VISIBLE', 403, '/api/v1/users/22'), {
          status: 403,
        }),
      ),
    );

    renderWithProviders(<ProfilePage userId={22} />);

    expect(await screen.findByRole('heading', { name: 'This profile is private' })).toBeVisible();
    expect(screen.getByText(/followers can see it/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers a retry when the failure is not an answer about the profile', async () => {
    // 429 rather than 500: a 5xx is retried twice by `shouldRetry` before it
    // surfaces, and this test is about the rendered branch, not the backoff.
    server.use(
      http.get(PROFILE_PATH, () =>
        HttpResponse.json(errorBody('RATE_LIMITED', 429, '/api/v1/users/22'), { status: 429 }),
      ),
    );

    renderWithProviders(<ProfilePage userId={22} />);

    expect(
      await screen.findByRole('heading', { name: "Couldn't load this profile" }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('renders the empty posts state for an author who has never posted', async () => {
    // User 24 exists (so the profile resolves) but has no entry in
    // `authorPosts` — a real 200 with an empty page, not a 404.
    renderWithProviders(<ProfilePage userId={24} />);

    // No display name either: the header must fall back rather than render a
    // blank line.
    expect(await screen.findByRole('heading', { level: 1, name: 'User 24' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'No posts yet' })).toBeVisible();
    expect(screen.getByText("When they post, it'll show up here.")).toBeVisible();
  });

  it('announces the loading state before anything resolves', () => {
    renderWithProviders(<ProfilePage userId={22} />);

    expect(screen.getByText('Loading this profile…')).toBeInTheDocument();
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderWithProviders(<ProfilePage userId={22} />, { locale: 'bn' });

    // The display name is data, not copy: it stays as it is.
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Rahman' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'পোস্ট' })).toBeVisible();
    expect(screen.getByText('ফলোয়ার')).toBeVisible();
  });
});
