import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import type { FeedPost } from '@/lib/api/feed';
import { apiBaseUrl } from '@/lib/env';
import { renderWithProviders } from '@/lib/testing/render';
import { homeFeedPosts, postMedia } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { PostCard } from './post-card';

/**
 * A single feed card.
 *
 * The card's only real job is to make an id-only payload readable: `PostView`
 * carries `author_id`, so the display name arrives from a second request. Every
 * assertion below is about the card staying usable while that request is in
 * flight, fails, or is answered with a profile that has no name at all.
 *
 * (নাম না এলে কার্ড ভাঙে না — একটা অনুবাদিত fallback দেখায়।)
 */

function post(id: number): FeedPost {
  const found = homeFeedPosts.find((item) => item.id === id);
  if (!found) throw new Error(`fixture post ${String(id)} is missing`);
  // The hand-mirrored contract types `visibility` as a bare `string` and the
  // two flags as optional, while the OpenAPI schema the feed is typed from (and
  // the backend, which has an enum) narrows/enforces all three.
  return {
    ...found,
    visibility: found.visibility as FeedPost['visibility'],
    // Likewise `media[].kind`: the hand-mirrored contract types it as a bare
    // `string`, while the OpenAPI schema narrows it to `"image" | "video"`.
    media: found.media as FeedPost['media'],
    is_edited: found.is_edited ?? false,
    is_liked_by_me: found.is_liked_by_me ?? false,
  };
}

describe('PostCard', () => {
  it('renders the body, the resolved author name and the counts', async () => {
    renderWithProviders(<PostCard post={post(101)} />);

    expect(await screen.findByText('Alice Rahman')).toBeInTheDocument();
    expect(screen.getByText(post(101).body)).toBeInTheDocument();
    // Counts are compact-formatted, and each one also has an sr-only label.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('exposes the like state through the card', () => {
    renderWithProviders(<PostCard post={post(101)} />);

    // Post 101 is unliked with 12 likes: the button owns both the count and
    // `aria-pressed`, the card only supplies them.
    const like = screen.getByRole('button', { name: '12 Like' });
    expect(like).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows an already-liked post as pressed', () => {
    renderWithProviders(<PostCard post={post(102)} />);

    expect(screen.getByRole('button', { name: '4 Unlike' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('carries the raw ISO timestamp on the <time> element', () => {
    renderWithProviders(<PostCard post={post(101)} />);

    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-01-15T09:58:00.000Z');
  });

  it('falls back to a translated placeholder when the profile has no name', async () => {
    renderWithProviders(<PostCard post={post(103)} />);

    // Author 24 has `display_name: null` — the contract allows that.
    expect(await screen.findByText('User 24')).toBeInTheDocument();
  });

  it('still renders the fallback when the profile request fails', async () => {
    const body: ApiErrorBody = {
      error: 'PROFILE_NOT_FOUND',
      status: 404,
      detail: 'Profile not found',
      path: '/api/v1/users/22',
      request_id: 'test-request-id',
    };
    server.use(http.get('*/api/v1/users/:user_id', () => HttpResponse.json(body, { status: 404 })));

    renderWithProviders(<PostCard post={post(101)} />);

    expect(await screen.findByText('User 22')).toBeInTheDocument();
    expect(screen.getByText(post(101).body)).toBeInTheDocument();
  });

  it('marks an edited post', () => {
    renderWithProviders(<PostCard post={post(103)} />);

    expect(screen.getByText('Edited')).toBeInTheDocument();
  });

  it('announces the visibility in words, not just as an icon', () => {
    renderWithProviders(<PostCard post={post(103)} />);

    // Post 103 is followers-only: the icon is decoration, the words are the label.
    expect(screen.getByText('Visibility: Followers')).toBeInTheDocument();
  });

  it('renders attached media resolved against the API origin', () => {
    renderWithProviders(<PostCard post={post(102)} />);

    // Post 102's fixture URL is root-relative (`/static/media/…`). Left alone it
    // would resolve against the Next.js origin, which is a different host from
    // the API, so the card must prefix it.
    expect(screen.getByRole('img', { name: 'Attached image 1' })).toHaveAttribute(
      'src',
      `${apiBaseUrl}${postMedia.url}`,
    );
    // The grid is named so a screen reader gets the count, not just "graphic".
    expect(screen.getByRole('list', { name: '1 attachment' })).toBeInTheDocument();
  });

  it('renders no media grid for a post without attachments', () => {
    // `media` is optional on `PostView` and absent on older responses; post 101
    // has neither the key nor any media.
    renderWithProviders(<PostCard post={post(101)} />);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('img', { name: /Attached image/ })).toBeNull();
  });

  it('links to the post detail route', () => {
    renderWithProviders(<PostCard post={post(101)} />);

    expect(screen.getByRole('link', { name: 'Open post' })).toHaveAttribute('href', '/posts/101');
  });

  it('renders Bangla copy under the bn locale', async () => {
    renderWithProviders(<PostCard post={post(103)} />, { locale: 'bn' });

    expect(screen.getByText('সম্পাদিত')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'পোস্ট খুলুন' })).toBeInTheDocument();
    expect(await screen.findByText('ব্যবহারকারী 24')).toBeInTheDocument();
  });
});
