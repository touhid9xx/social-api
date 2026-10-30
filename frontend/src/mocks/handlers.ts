import { HttpResponse, http } from 'msw';

import type { ApiErrorBody } from '@/types';

import type {
  CommentCreate,
  CommentPage,
  CommentView,
  ExploreFeedPage,
  FollowCounts,
  FollowListPage,
  FollowStatus,
  HomeFeedPage,
  LoginRequest,
  LoginResponse,
  MarkReadResponse,
  NotificationPage,
  NotificationView,
  PostCreate,
  PostPage,
  PostView,
  RegisterRequest,
  RegisterResponse,
  UnreadCount,
} from '../../contracts/types';

import {
  adminProfile,
  adminTokens,
  adminUser,
  authorPosts,
  authorProfiles,
  DEMO_ADMIN_EMAIL,
  DEMO_PASSWORD,
  exploreFeedPosts,
  FIXTURE_NOW,
  followCounts,
  followersOf22,
  followingOf22,
  followStatus,
  homeFeedPosts,
  notifications,
  postComments,
  refreshedAccess,
  refreshedTokens,
  unreadNotificationCount,
} from './fixtures';

/**
 * MSW request handlers mirroring the real backend contract. Paths are
 * host-agnostic (`*​/…`) so they match both relative `fetch('/api/v1/…')` calls
 * and absolute calls against `NEXT_PUBLIC_API_URL`.
 *
 * (mock শুধু contract-এর shape নকল করে — endpoint নিজে নয়; F3-তে client আসল API ধরে নেবে।)
 */

const TEST_REQUEST_ID = 'test-request-id';

/**
 * Ids for posts created through the mock, starting well above the fixture range
 * (101–103) so a test can tell a created post from a seeded one.
 */
let nextCreatedPostId = 900;

/** Comment ids start above the fixture range (501–503) for the same reason. */
let nextCreatedCommentId = 950;

function errorBody(error: string, status: number, path: string, detail: unknown): ApiErrorBody {
  return { error, status, detail, path, request_id: TEST_REQUEST_ID };
}

export const handlers = [
  // Public. Returns the NESTED envelope: { user, tokens }.
  http.post('*/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as LoginRequest;

    if (body.email !== DEMO_ADMIN_EMAIL || body.password !== DEMO_PASSWORD) {
      return HttpResponse.json(
        errorBody('INVALID_CREDENTIALS', 401, '/api/v1/auth/login', 'Invalid email or password'),
        { status: 401 },
      );
    }

    const payload: LoginResponse = { user: adminUser, tokens: adminTokens };
    return HttpResponse.json(payload);
  }),

  // Public. 201 with `{ user, message }` and NO tokens: the backend mails a
  // verification link, and only /auth/login mints a session.
  http.post('*/api/v1/auth/register', async ({ request }) => {
    const body = (await request.json()) as RegisterRequest;

    if (body.email === DEMO_ADMIN_EMAIL) {
      return HttpResponse.json(
        errorBody(
          'EMAIL_ALREADY_REGISTERED',
          409,
          '/api/v1/auth/register',
          'Email already registered',
        ),
        { status: 409 },
      );
    }

    const payload: RegisterResponse = {
      user: { ...adminUser, is_verified: false },
      message: 'Verification email sent',
    };
    return HttpResponse.json(payload, { status: 201 });
  }),

  // Public, body-driven. Returns the FLAT token envelope — not nested.
  http.post('*/api/v1/auth/refresh', () => HttpResponse.json(refreshedTokens)),

  http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  // ---------------------------------------------------------------------------
  // Same-origin Next route handlers (`src/app/api/auth/*`). In the real browser
  // MSW only ever sees the client half of the httpOnly cookie exchange, so the
  // mocks mirror the client-visible contract: no refresh token in any body.
  // ---------------------------------------------------------------------------
  http.post('*/api/auth/session', () => new HttpResponse(null, { status: 204 })),

  http.post('*/api/auth/refresh', () => HttpResponse.json(refreshedAccess)),

  http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.get('*/api/v1/users/me', () => HttpResponse.json(adminProfile)),

  // `PostView` carries `author_id` only, so every feed card resolves its author
  // here. Registered AFTER `/users/me` on purpose: MSW takes the first match, so
  // the literal route has to win over `:user_id`.
  //
  // Unknown ids are a real 404 (`PROFILE_NOT_FOUND`), not a made-up profile —
  // a test that asks for an author nobody seeded must fail loudly.
  http.get('*/api/v1/users/:user_id', ({ params }) => {
    const raw = String(params.user_id);
    const profile = authorProfiles[Number(raw)];

    if (!profile) {
      return HttpResponse.json(
        errorBody('PROFILE_NOT_FOUND', 404, `/api/v1/users/${raw}`, 'Profile not found'),
        { status: 404 },
      );
    }

    return HttpResponse.json(profile);
  }),

  // ---------------------------------------------------------------------------
  // Follow graph (F11). Four reads under `/users/{id}/…` plus two writes under
  // `/follows/{id}`.
  //
  // `follow-status` is viewer-relative, so it is served from a fixture map keyed
  // by TARGET id and only ever means "as the signed-in admin". An unknown target
  // is a real 404 `PROFILE_NOT_FOUND`, the same answer `GET /users/{id}` gives —
  // the status endpoint must not invent a user the profile endpoint denies.
  // ---------------------------------------------------------------------------
  http.get('*/api/v1/users/:user_id/follow-status', ({ params }) => {
    const raw = String(params.user_id);
    const status = followStatus[Number(raw)];

    if (!status) {
      return HttpResponse.json(
        errorBody(
          'PROFILE_NOT_FOUND',
          404,
          `/api/v1/users/${raw}/follow-status`,
          'Profile not found',
        ),
        { status: 404 },
      );
    }

    const payload: FollowStatus = status;
    return HttpResponse.json(payload);
  }),

  // Public and slow-changing: zero is a real answer, never a 404.
  http.get('*/api/v1/users/:user_id/follow-counts', ({ params }) => {
    const raw = String(params.user_id);
    const profile = authorProfiles[Number(raw)];

    if (!profile) {
      return HttpResponse.json(
        errorBody(
          'PROFILE_NOT_FOUND',
          404,
          `/api/v1/users/${raw}/follow-counts`,
          'Profile not found',
        ),
        { status: 404 },
      );
    }

    const payload: FollowCounts = followCounts[Number(raw)] ?? { followers: 0, following: 0 };
    return HttpResponse.json(payload);
  }),

  // Cursor paginated like every other list. Only Alice (22) has a seeded graph;
  // everyone else genuinely has an empty one, which is a 200 rather than a 404.
  http.get('*/api/v1/users/:user_id/followers', ({ request, params }) => {
    const raw = String(params.user_id);
    const all = Number(raw) === 22 ? followersOf22 : [];

    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const start = Number(url.searchParams.get('cursor') ?? '0');

    const payload: FollowListPage = {
      items: all.slice(start, start + limit),
      next_cursor: start + limit < all.length ? String(start + limit) : null,
    };
    return HttpResponse.json(payload);
  }),

  http.get('*/api/v1/users/:user_id/following', ({ request, params }) => {
    const raw = String(params.user_id);
    const all = Number(raw) === 22 ? followingOf22 : [];

    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const start = Number(url.searchParams.get('cursor') ?? '0');

    const payload: FollowListPage = {
      items: all.slice(start, start + limit),
      next_cursor: start + limit < all.length ? String(start + limit) : null,
    };
    return HttpResponse.json(payload);
  }),

  // Both writes answer 204 with no body, exactly like the real endpoints: the
  // client patches `is_following` and the follower total optimistically, so
  // there is nothing here to merge back.
  http.post('*/api/v1/follows/:user_id', () => new HttpResponse(null, { status: 204 })),

  http.delete('*/api/v1/follows/:user_id', () => new HttpResponse(null, { status: 204 })),

  // One author's posts (F11). Same envelope as the feeds, so it feeds `PostFeed`
  // unchanged. An author with no posts is an empty page, NOT a 404 — only an
  // unknown user is a 404, and the profile request answers that first.
  http.get('*/api/v1/posts/by-author/:author_id', ({ request, params }) => {
    const raw = String(params.author_id);
    const userId = Number(raw);

    if (!authorProfiles[userId]) {
      return HttpResponse.json(
        errorBody('PROFILE_NOT_FOUND', 404, `/api/v1/posts/by-author/${raw}`, 'Profile not found'),
        { status: 404 },
      );
    }

    const all = authorPosts[userId] ?? [];

    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const start = Number(url.searchParams.get('cursor') ?? '0');

    const payload: PostPage = {
      items: all.slice(start, start + limit),
      next_cursor: start + limit < all.length ? String(start + limit) : null,
    };
    return HttpResponse.json(payload);
  }),

  // Cursor paginated: opaque `next_cursor`, never an offset.
  http.get('*/api/v1/feed/home', ({ request }) => {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '2');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 2;
    const cursor = url.searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    const items = homeFeedPosts.slice(start, start + limit);

    const payload: HomeFeedPage = {
      items,
      next_cursor: start + limit < homeFeedPosts.length ? String(start + limit) : null,
      cache_hit: false,
    };
    return HttpResponse.json(payload);
  }),

  // ---------------------------------------------------------------------------
  // The post detail route (F9): one post, then its thread.
  //
  // An unknown post is a real 404 `POST_NOT_FOUND` — the fixture set is the
  // contract, and inventing a post for an id nobody seeded would hide a broken
  // link instead of failing the test that follows it.
  //
  // The thread is served from `postComments` and NEVER mutated by the create
  // handler below: a shared fixture that grows would leak one test's comment into
  // the next. "The new comment appears" is a refetch, which the invalidation in
  // `useCreateComment` performs.
  // ---------------------------------------------------------------------------
  http.get('*/api/v1/posts/:post_id', ({ params }) => {
    const raw = String(params.post_id);
    const post = homeFeedPosts.find((item) => item.id === Number(raw));

    if (!post) {
      return HttpResponse.json(
        errorBody('POST_NOT_FOUND', 404, `/api/v1/posts/${raw}`, 'Post not found'),
        { status: 404 },
      );
    }

    return HttpResponse.json(post);
  }),

  http.get('*/api/v1/posts/:post_id/comments', ({ request, params }) => {
    const raw = String(params.post_id);
    const post = homeFeedPosts.find((item) => item.id === Number(raw));

    if (!post) {
      return HttpResponse.json(
        errorBody('POST_NOT_FOUND', 404, `/api/v1/posts/${raw}`, 'Post not found'),
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    // The opaque cursor is an index here; the real one is opaque, which is
    // exactly why the client never parses it.
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const thread = postComments.filter((comment) => comment.post_id === post.id);
    const items = thread.slice(start, start + limit);

    const payload: CommentPage = {
      items,
      next_cursor: start + limit < thread.length ? String(start + limit) : null,
    };
    return HttpResponse.json(payload);
  }),

  // Same envelope as the home feed; a different, non-overlapping corpus so a
  // test can tell which endpoint produced a page.
  http.get('*/api/v1/feed/explore', ({ request }) => {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const cursor = url.searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    const items = exploreFeedPosts.slice(start, start + limit);

    const payload: ExploreFeedPage = {
      items,
      next_cursor: start + limit < exploreFeedPosts.length ? String(start + limit) : null,
      cache_hit: false,
    };
    return HttpResponse.json(payload);
  }),

  // Registered BEFORE `GET /notifications` so the literal path wins over any
  // `:id` route a later milestone adds — MSW takes the first match.
  http.get('*/api/v1/notifications/unread-count', () => {
    const payload: UnreadCount = unreadNotificationCount;
    return HttpResponse.json(payload);
  }),

  // Cursor paginated, same opaque-cursor convention as the feeds.
  // `unread_only` filters BEFORE slicing, because that is what the server does:
  // filtering an already-sliced page would return short pages for the wrong
  // reason and make `next_cursor` meaningless.
  http.get('*/api/v1/notifications', ({ request }) => {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
    const cursor = url.searchParams.get('cursor');
    const start = cursor ? Number(cursor) : 0;
    const unreadOnly = url.searchParams.get('unread_only') === 'true';

    const rows = unreadOnly ? notifications.filter((row) => !row.is_read) : notifications;
    const items = rows.slice(start, start + limit);

    const payload: NotificationPage = {
      items,
      next_cursor: start + limit < rows.length ? String(start + limit) : null,
    };
    return HttpResponse.json(payload);
  }),

  // Returns the WHOLE updated row, which is what lets the client patch one cache
  // entry instead of invalidating every loaded page. The shared fixture is not
  // mutated — the same reason the post/comment create handlers stay read-only.
  http.post('*/api/v1/notifications/:notif_id/read', ({ params }) => {
    const raw = String(params.notif_id);
    const row = notifications.find((item) => item.id === Number(raw));

    if (!row) {
      return HttpResponse.json(
        errorBody(
          'NOTIFICATION_NOT_FOUND',
          404,
          `/api/v1/notifications/${raw}/read`,
          'Notification not found',
        ),
        { status: 404 },
      );
    }

    const updated: NotificationView = { ...row, is_read: true, read_at: FIXTURE_NOW };
    return HttpResponse.json(updated);
  }),

  // `{ updated }` is the number of rows actually flipped; 0 is a normal answer,
  // so an already-read inbox is a 200 rather than an error or a 204.
  http.post('*/api/v1/notifications/read-all', () => {
    const payload: MarkReadResponse = {
      updated: notifications.filter((row) => !row.is_read).length,
    };
    return HttpResponse.json(payload);
  }),

  // 204 with no body: the row is removed from the cache optimistically.
  http.delete('*/api/v1/notifications/:notif_id', () => new HttpResponse(null, { status: 204 })),

  // ---------------------------------------------------------------------------
  // Writes (F8).
  //
  // The create handler deliberately does NOT push into `homeFeedPosts`: that
  // array is a shared fixture, and mutating it would leak one test's post into
  // the next. It answers with a contract-shaped `PostView` instead, which is all
  // a composer test needs — "the feed shows it" is a refetch, not an insert.
  // ---------------------------------------------------------------------------
  http.post('*/api/v1/posts', async ({ request }) => {
    const body = (await request.json()) as PostCreate;
    const text = body.body.trim();

    // `PostCreate` is `min_length=1` on the server, so a blank body is a real
    // 422 — the client validates first, and this keeps the mock honest when a
    // test bypasses the form.
    if (text.length === 0) {
      return HttpResponse.json(
        errorBody('VALIDATION_ERROR', 422, '/api/v1/posts', 'body: must not be empty'),
        { status: 422 },
      );
    }

    const created: PostView = {
      id: nextCreatedPostId++,
      author_id: adminUser.id,
      body: text,
      visibility: body.visibility ?? 'public',
      like_count: 0,
      comment_count: 0,
      media_count: 0,
      version: 1,
      created_at: FIXTURE_NOW,
      updated_at: FIXTURE_NOW,
      is_liked_by_me: false,
      is_edited: false,
    };

    return HttpResponse.json(created, { status: 201 });
  }),

  // Both answer 204 with no body: the UI updates optimistically.
  http.post(
    '*/api/v1/likes/:target_type/:target_id',
    () => new HttpResponse(null, { status: 204 }),
  ),

  // `CommentCreate` is `min_length=1`, and depth is capped at 2 on the server:
  // a reply to a reply is a real 422, so the mock refuses it too rather than
  // accepting something the backend would reject.
  http.post('*/api/v1/posts/:post_id/comments', async ({ request, params }) => {
    const raw = String(params.post_id);
    const post = homeFeedPosts.find((item) => item.id === Number(raw));

    if (!post) {
      return HttpResponse.json(
        errorBody('POST_NOT_FOUND', 404, `/api/v1/posts/${raw}`, 'Post not found'),
        { status: 404 },
      );
    }

    const body = (await request.json()) as CommentCreate;
    const text = (body.body ?? '').trim();

    if (text.length === 0) {
      return HttpResponse.json(
        errorBody(
          'VALIDATION_ERROR',
          422,
          `/api/v1/posts/${raw}/comments`,
          'body must not be empty',
        ),
        { status: 422 },
      );
    }

    const parentId = body.parent_id ?? null;
    let depth = 0;

    if (parentId !== null) {
      // A reply is serialised INSIDE its parent (`CommentView.replies`), but it is
      // still a comment row the backend can resolve by id — so the lookup has to
      // look one level down too. Searching only the top-level page would answer
      // 404 for a real comment and hide the depth limit behind it.
      const parent =
        postComments.find((comment) => comment.id === parentId) ??
        postComments
          .flatMap((comment) => comment.replies ?? [])
          .find((reply) => reply.id === parentId);

      if (!parent) {
        return HttpResponse.json(
          errorBody('COMMENT_NOT_FOUND', 404, `/api/v1/posts/${raw}/comments`, 'Comment not found'),
          { status: 404 },
        );
      }

      if (parent.depth >= 1) {
        return HttpResponse.json(
          errorBody(
            'COMMENT_DEPTH_EXCEEDED',
            422,
            `/api/v1/posts/${raw}/comments`,
            'Maximum comment depth exceeded',
          ),
          { status: 422 },
        );
      }

      depth = parent.depth + 1;
    }

    const created: CommentView = {
      id: nextCreatedCommentId++,
      post_id: post.id,
      author_id: adminUser.id,
      parent_id: parentId,
      depth,
      body: text,
      like_count: 0,
      created_at: FIXTURE_NOW,
      updated_at: FIXTURE_NOW,
      is_liked_by_me: false,
      is_edited: false,
    };

    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete(
    '*/api/v1/likes/:target_type/:target_id',
    () => new HttpResponse(null, { status: 204 }),
  ),
];
