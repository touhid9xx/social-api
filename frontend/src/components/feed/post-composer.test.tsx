import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IDEMPOTENCY_HEADER } from '@/lib/api/idempotency';
import { MEDIA_MAX_IMAGE_BYTES } from '@/lib/api/media';
import type { PostCreateBody } from '@/lib/api/posts';
import { renderWithProviders } from '@/lib/testing/render';
import { uploadedFile } from '@/mocks/multipart';
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

const MEDIA_PATH = '*/api/v1/media';
const ATTACH_PATH = '*/api/v1/media/:media_id/attach/:post_id';

/** jsdom ships no object URLs; the composer makes one per image preview. */
beforeEach(() => {
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => undefined;
});

/** `FormData.append` is spied on to read the upload filename — never leak the spy. */
afterEach(() => {
  vi.restoreAllMocks();
});

function imageFile(name: string, size = 1024): File {
  const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type: 'image/png' });
  // `File.size` is a prototype getter, so an oversized fixture is faked instead
  // of allocating 10 MB just to have the browser refuse it.
  if (size !== file.size) Object.defineProperty(file, 'size', { value: size });
  return file;
}

/**
 * Record the publish sequence. Media is two extra requests per file, and the
 * order is the assertion that matters: `PostCreate` is `extra="forbid"`, so the
 * post has to exist before anything can be attached to it.
 */
function capturePublish() {
  const order: string[] = [];

  function mediaBody(id: number, postId: number | null) {
    return {
      id,
      owner_id: 21,
      post_id: postId,
      kind: 'image',
      mime: 'image/png',
      size_bytes: 1024,
      url: `/static/media/mock/${String(id)}`,
      created_at: '2024-05-01T12:00:00Z',
    };
  }

  server.use(
    http.post(POSTS_PATH, () => {
      order.push('create');
      return HttpResponse.json({ id: 901 }, { status: 201 });
    }),
    http.post(MEDIA_PATH, async ({ request }) => {
      // `request.formData()` cannot parse a jsdom payload (undici brand-checks
      // each part against its own `File`), so the part is read from the raw body
      // — see `@/mocks/multipart`. Only its presence is asserted here: jsdom's
      // `FormData` serialises an uploaded `File` as the string `[object Blob]`,
      // so the bytes and filename never reach the wire. What the product
      // actually sends is pinned by the `FormData.append` assertion below.
      const file = await uploadedFile(request);
      order.push(file ? 'upload' : 'upload:missing');
      return HttpResponse.json(mediaBody(980, null), { status: 201 });
    }),
    http.post(ATTACH_PATH, ({ params }) => {
      order.push(`attach:${String(params.media_id)}:${String(params.post_id)}`);
      return HttpResponse.json(mediaBody(980, Number(params.post_id)));
    }),
  );

  return { order };
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

  it('creates the post, uploads the attachment, then attaches it', async () => {
    const user = userEvent.setup();
    const { order } = capturePublish();
    // The filename is the one thing the mock cannot observe: jsdom's `FormData`
    // stringifies an uploaded `File` (`[object Blob]`), so `body.append` is the
    // last point where it still exists. It must be passed explicitly — the fetch
    // spec only infers it for a *native* `File`, and a plain `Blob` would upload
    // as `blob`.
    const append = vi.spyOn(FormData.prototype, 'append');
    renderWithProviders(<PostComposer />);

    await user.type(bodyField(), 'With a picture');
    await user.upload(screen.getByLabelText('Add media'), imageFile('cat.png'));

    // A preview means the file survived the client-side size/type checks.
    expect(await screen.findByAltText('cat.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Post' }));

    // post -> upload -> attach, and the attach targets the post just created.
    await waitFor(() => expect(order).toEqual(['create', 'upload', 'attach:980:901']));
    expect(append).toHaveBeenCalledWith('file', expect.any(File), 'cat.png');
    await waitFor(() => expect(bodyField()).toHaveValue(''));
    expect(screen.queryByAltText('cat.png')).toBeNull();
  });

  it('refuses an oversized attachment without spending a single request', async () => {
    const user = userEvent.setup();
    const { order } = capturePublish();
    renderWithProviders(<PostComposer />);

    await user.upload(
      screen.getByLabelText('Add media'),
      imageFile('huge.png', MEDIA_MAX_IMAGE_BYTES + 1),
    );

    // Named in the message: several files can be picked at once.
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.png is too large to attach.');
    expect(screen.queryByAltText('huge.png')).toBeNull();
    expect(order).toEqual([]);
  });

  it('renders Bangla copy under the bn locale', () => {
    renderWithProviders(<PostComposer />, { locale: 'bn' });

    expect(screen.getByLabelText('পোস্টের বিষয়বস্তু')).toBeInTheDocument();
    expect(screen.getByLabelText('কে এটি দেখতে পাবে')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পোস্ট করুন' })).toBeInTheDocument();
    expect(screen.getByText(/অক্ষর বাকি/)).toBeInTheDocument();
  });
});
