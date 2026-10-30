import { describe, expect, it } from 'vitest';

import type { ApiErrorBody } from '@/types';

import type { AuthTokens, HomeFeedPage, LoginResponse } from '../../contracts/types';
import { DEMO_ADMIN_EMAIL, DEMO_PASSWORD, refreshedAccess } from './fixtures';

/**
 * Proves the MSW layer is actually wired into the suite and that the responses
 * match the backend contract (nested login envelope, FLAT refresh envelope,
 * cursor pagination, shared error body).
 *
 * (এই test না থাকলে mock ভাঙলেও টের পেতাম না — তাই MSW নিজেই যাচাই করা হচ্ছে।)
 */

function loginRequest(password: string): Promise<Response> {
  return fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_ADMIN_EMAIL, password }),
  });
}

describe('MSW contract handlers', () => {
  it('returns the nested login envelope for the seeded demo admin', async () => {
    const response = await loginRequest(DEMO_PASSWORD);
    expect(response.status).toBe(200);

    const body = (await response.json()) as LoginResponse;
    expect(body.user.role).toBe('admin');
    expect(body.user.is_verified).toBe(true);
    expect(body.tokens.token_type).toBe('Bearer');
    expect(body.tokens.expires_in).toBe(900);
  });

  it('returns the FLAT token envelope on a backend refresh, never nested under tokens', async () => {
    const response = await fetch('/api/v1/auth/refresh', { method: 'POST' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as AuthTokens;
    expect(body.access_token).not.toBe('');
    expect(body).not.toHaveProperty('tokens');
  });

  it('hands the browser an access token only — never a refresh token', async () => {
    // The same-origin route handler keeps the rotated refresh token in the
    // httpOnly cookie, so the body the client can read must not carry one.
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    expect(response.status).toBe(200);

    const body = (await response.json()) as Omit<AuthTokens, 'refresh_token'>;
    expect(body.access_token).toBe(refreshedAccess.access_token);
    expect(body).not.toHaveProperty('refresh_token');
  });

  it('rejects bad credentials with the shared backend error envelope', async () => {
    const response = await loginRequest('wrong-password');
    expect(response.status).toBe(401);

    const body = (await response.json()) as ApiErrorBody;
    expect(body.error).toBe('INVALID_CREDENTIALS');
    expect(body.status).toBe(401);
    expect(body.path).toBe('/api/v1/auth/login');
    expect(body.request_id).toBe('test-request-id');
  });

  it('paginates the home feed with an opaque next_cursor', async () => {
    const firstResponse = await fetch('/api/v1/feed/home?limit=2');
    const first = (await firstResponse.json()) as HomeFeedPage;
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBe('2');

    const secondResponse = await fetch(
      `/api/v1/feed/home?limit=2&cursor=${String(first.next_cursor)}`,
    );
    const second = (await secondResponse.json()) as HomeFeedPage;
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
  });
});
