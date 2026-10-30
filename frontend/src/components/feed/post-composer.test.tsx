import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';
import type { PostCreateBody } from '@/lib/api/posts';
import { renderWithProviders } from '@/lib/testing/render';
import { server } from '@/mocks/server';
import type { ApiErrorBody } from '@/types';

import { PostComposer } from './post-composer';

/**
 * The post composer.
 *
 * `POST /api/v1/posts` is the only write this slice adds, and the composer must
 * never spend it on something the backend would reject: a blank body is caught
 * by `postSchema` before the request leaves the browser, and only a valid draft
 * becomes a mutation. The success signal is the `role="status"` line — the toast
 * is not asserted because the `Toaster` lives in the root layout, which
 * `renderWithProviders` does not mount.
 *
 * Nothing is inserted optimistically: the feed is ranked server-side, so the
 * observable effect of a publish here is "the draft is cleared", not "a card
 * appears".
 *
 * (খালি পোস্ট যাবে না — network-এ যাওয়ার আগেই form আটকে দেয়।)
 */

const POSTS_PATH = '*/api/v1/posts';

/** Count requests and echo back a contract-shaped `PostView`. */
function capture() {
  const seen: { calls: number; body?: PostCreateBody; key?: string | null } = { calls: 0 };
  server.use(
    http.post(POSTS_PATH, async ({ request }) => {
      seen.calls += 1;
      seen.body = (await request.json()) as PostCreateBody;
      seen.key = request.headers.get(IDEMPOTENCY_HEADER);
      return HttpResponse.json({ id: 901 }, { status: 201 });
    }),
  );
  return seen;
}

function bodyField() {
  return screen.getByLabelText('Post body');
}

describe('PostComposer', () => {
  it('renders the field, the visibility selector and the action', () => {
    renderWithProviders(<PostComposer />);

    expect(bodyField()).toBeInTheDocument();
    expect(screen.getByLabelText('Who can see this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    expect(bodyField()).toHaveAttribute('maxlength', '5000');
  });

  it('offers the three visibilities the backend accepts, public first', () => {
    renderWithProviders(<PostComposer />);

    const options = screen.getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual(['Public', 'Followers', 'Private']);
    expect(screen.getByLabelText('Who can see this')).toHaveValue('public');
  });

  it('counts down the remaining characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostComposer />);

    // `#` in the ICU plural is number-formatted too, so the count is grouped.
    expect(screen.getByText('5,000 characters left')).toBeInTheDocument();

    await user.type(bodyField(), 'Hello');

    expect(screen.getByText('4,995 characters left')).toBeInTheDocument();
  });

  it('refuses an empty draft without calling the API', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<PostComposer />);

    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByText('Write something before posting.')).toBeInTheDocument();
    expect(seen.calls).toBe(0);
  });

  it('treats a whitespace-only draft as empty', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<PostComposer />);

    await user.type(bodyField(), '    ');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    expect(await screen.findByText('Write something before posting.')).toBeInTheDocument();
    expect(seen.calls).toBe(0);
  });

  it('clears the validation error as soon as the user types', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PostComposer />);

    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Write something before posting.')).toBeInTheDocument();

    await user.type(bodyField(), 'H');

    expect(screen.queryByText('Write something before posting.')).toBeNull();
  });

  it('publishes the trimmed body with a fresh idempotency key, then clears itself', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<PostComposer />);

    await user.type(bodyField(), '  Hello feed  ');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(seen.calls).toBe(1));
    // Trimmed by the schema, not by the backend's 422.
    expect(seen.body).toEqual({ body: 'Hello feed', visibility: 'public' });
    // A retried submit must resolve to the first post, not a duplicate.
    expect(seen.key).toMatch(/^[\w-]{8,128}$/);

    await waitFor(() => expect(bodyField()).toHaveValue(''));
    expect(screen.getByRole('status')).toHaveTextContent('Post published');
  });

  it('sends the chosen visibility', async () => {
    const user = userEvent.setup();
    const seen = capture();
    renderWithProviders(<PostComposer />);

    await user.type(bodyField(), 'Followers only');
    await user.selectOptions(screen.getByLabelText('Who can see this'), 'followers');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    await waitFor(() => expect(seen.calls).toBe(1));
    expect(seen.body?.visibility).toBe('followers');
  });

  it('keeps the draft and surfaces the shared message when the API rejects it', async () => {
    const user = userEvent.setup();
    const body: ApiErrorBody = {
      error: 'VALIDATION_ERROR',
      status: 422,
      detail: 'body: must not be empty',
      path: '/api/v1/posts',
      request_id: 'test-request-id',
    };
    server.use(http.post(POSTS_PATH, () => HttpResponse.json(body, { status: body.status })));
    renderWithProviders(<PostComposer />);

    await user.type(bodyField(), 'Hello feed');
    await user.click(screen.getByRole('button', { name: 'Post' }));

    // 422 -> errors.validationError, never the raw code.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please check the highlighted fields and try again.',
    );
    // A failed publish must not eat what the user wrote.
    expect(bodyField()).toHaveValue('Hello feed');
  });

  it('renders Bangla copy under the bn locale', () => {
    renderWithProviders(<PostComposer />, { locale: 'bn' });

    expect(screen.getByLabelText('পোস্টের বিষয়বস্তু')).toBeInTheDocument();
    expect(screen.getByLabelText('কে এটি দেখতে পাবে')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পোস্ট করুন' })).toBeInTheDocument();
    expect(screen.getByText(/অক্ষর বাকি/)).toBeInTheDocument();
  });
});
