import { NextResponse } from 'next/server';

import { backendUrl, clearAuthCookies, isSecureRequest } from '@/lib/server/session';

/**
 * `POST /api/auth/logout` — end the session on both sides.
 *
 * Best effort on purpose: the backend revokes the current access token
 * (Redis blacklist), but the local cookies are cleared even when the call
 * fails or the token has already expired. A user who clicks "sign out" must
 * never be left holding a refresh cookie because the API was down.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');

  if (authorization) {
    try {
      await fetch(backendUrl('/api/v1/auth/logout'), {
        method: 'POST',
        headers: { authorization },
        cache: 'no-store',
      });
    } catch {
      // Unreachable API: the local session still ends below.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearAuthCookies(response, isSecureRequest(request));
  return response;
}
