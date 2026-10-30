import { NextResponse } from 'next/server';

import {
  clearAuthCookies,
  errorEnvelope,
  isSecureRequest,
  setRefreshCookie,
} from '@/lib/server/session';
import { SESSION_ENDPOINTS } from '@/lib/session-constants';

/**
 * `POST /api/auth/session` — adopt the refresh token issued by `/auth/login`.
 *
 * Login talks to the backend straight from the browser (the OpenAPI-typed
 * `apiClient` call, and the per-IP login rate limit stays correct). The
 * refresh token in that response is immediately handed to this handler, which
 * parks it in an httpOnly cookie and hands back nothing. From that moment the
 * long-lived credential is unreadable by JavaScript, so an XSS payload cannot
 * steal a session that outlives the tab.
 *
 * `DELETE` drops the cookies without calling the backend — used when the
 * session is already dead locally (failed refresh, revoked token).
 */

export const dynamic = 'force-dynamic';

const MAX_TOKEN_LENGTH = 4096;

function refreshTokenFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = (body as { refresh_token?: unknown }).refresh_token;
  if (typeof candidate !== 'string') return null;
  const token = candidate.trim();
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secure = isSecureRequest(request);

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const refreshToken = refreshTokenFrom(body);
  if (!refreshToken) {
    return NextResponse.json(
      errorEnvelope(
        'BAD_REQUEST',
        400,
        SESSION_ENDPOINTS.adopt,
        'A non-empty refresh_token string is required',
      ),
      { status: 400 },
    );
  }

  const response = new NextResponse(null, { status: 204 });
  setRefreshCookie(response, refreshToken, secure);
  return response;
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const response = new NextResponse(null, { status: 204 });
  clearAuthCookies(response, isSecureRequest(request));
  return response;
}
