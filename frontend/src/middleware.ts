import { NextResponse, type NextRequest } from 'next/server';

import { isProtectedPath, signInPath } from '@/lib/auth-routes';
import { REFRESH_COOKIE } from '@/lib/session-constants';

/**
 * Server-side session gate for the protected route groups.
 *
 * The access token lives in memory, so the server cannot see it — but the
 * httpOnly refresh cookie IS visible here (it is httpOnly, not server-only).
 * Its presence is therefore the one signal available before any JavaScript
 * runs, and acting on it here means a signed-out visitor never sees a
 * protected page shell, not even for a frame.
 *
 * Advisory, not authorization: the cookie's presence says "a session probably
 * exists", not "it is valid". Every protected request is still authorized by
 * the backend, and a cookie that turns out to be expired or revoked is caught
 * by the client guard (`components/shared/require-session.tsx`), which redirects
 * once the refresh attempt fails.
 *
 * One-directional on purpose. A cookie present on /login is NOT redirected to
 * /home: a revoked-but-present cookie would then bounce /home -> /login ->
 * /home forever. Letting the client guard own that decision is loop-free.
 *
 * (কুকি থাকলেই সার্ভারে ঢুকতে দেয়; আসল যাচাই ব্যাকএন্ড করে। উল্টো দিকে রিডাইরেক্ট
 *  নেই — নাহলে বাতিল হওয়া কুকি নিয়ে infinite loop হতো।)
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedPath(pathname)) return NextResponse.next();
  if (request.cookies.has(REFRESH_COOKIE)) return NextResponse.next();

  // `pnpm build` output shows this as a `ƒ Middleware` entry, not as a route.
  return NextResponse.redirect(new URL(signInPath(`${pathname}${search}`), request.nextUrl.origin));
}

/**
 * Only the protected prefixes run the middleware at all — a matcher is cheaper
 * than a function that returns early, and it keeps static assets, the landing
 * page and `/api/*` out of it entirely.
 *
 * MUST stay in sync with `PROTECTED_PREFIXES`; `auth-routes.test.ts` fails the
 * build if a prefix is added to one and not the other.
 */
export const config = {
  matcher: [
    '/home/:path*',
    '/explore/:path*',
    '/notifications/:path*',
    '/messages/:path*',
    '/search/:path*',
    '/settings/:path*',
    '/posts/:path*',
    '/profile/:path*',
    '/admin/:path*',
  ],
};
