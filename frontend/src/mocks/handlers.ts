import { HttpResponse, http } from 'msw';

import type { ApiErrorBody } from '@/types';

import type { HomeFeedPage, LoginRequest, LoginResponse, UnreadCount } from '../../contracts/types';

import {
  adminProfile,
  adminTokens,
  adminUser,
  DEMO_ADMIN_EMAIL,
  DEMO_PASSWORD,
  homeFeedPosts,
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

  // Public, cookie-driven. Returns the FLAT token envelope — not nested.
  http.post('*/api/v1/auth/refresh', () => HttpResponse.json(refreshedTokens)),

  http.post('*/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.get('*/api/v1/users/me', () => HttpResponse.json(adminProfile)),

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
