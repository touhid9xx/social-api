import { HttpResponse, http } from 'msw';

import type { ApiErrorBody } from '@/types';

import type {
  HomeFeedPage,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  UnreadCount,
} from '../../contracts/types';

import {
  adminProfile,
  adminTokens,
  adminUser,
  authorProfiles,
  DEMO_ADMIN_EMAIL,
  DEMO_PASSWORD,
  homeFeedPosts,
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

  http.get('*/api/v1/notifications/unread-count', () => {
    const payload: UnreadCount = unreadNotificationCount;
    return HttpResponse.json(payload);
  }),
];
