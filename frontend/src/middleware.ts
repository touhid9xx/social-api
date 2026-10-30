import { NextResponse, type NextRequest } from 'next/server';

import { isProtectedPath, signInPath } from '@/lib/auth-routes';
import { SESSION_HINT_COOKIE } from '@/lib/session-constants';

/**
 * Server-side session gate for the protected route groups.
 *
 * The access token lives in memory, so the server cannot see it. The durable
 * refresh cookie cannot stand in for it either: it is issued with
 * `path=/api/auth`, so the browser sends it ONLY to the session route handlers
 * and never to `/home`, `/profile/*` or any other page. Gating on it here
 * rejects every signed-in visitor, because the cookie simply is not in the
 * request — which is exactly the bug this gate used to have.
 *
 * The one signal that does reach a page request is the `sf_session` hint
 * cookie: root-pathed precisely so it is visible everywhere, and carrying no
 * credential — only the fact that a refresh cookie exists. It is set and
 * cleared alongside the refresh cookie, so the two cannot disagree for long.
 *
 * Advisory, not authorization: the hint says "a session probably exists", not
 * "it is valid". Every protected request is still authorized by the backend,
 * and a session that turns out to be expired or revoked is caught by the client
 * guard (`components/shared/require-session.tsx`), which redirects once the
 * refresh attempt fails.
 *
 * One-directional on purpose. A hint present on /login is NOT redirected to
 * /home: a revoked-but-present cookie would then bounce /home -> /login ->
 * /home forever. Letting the client guard own that decision is loop-free.
 *
 * (কুকি থাকলেই সার্ভারে ঢুকতে দেয়; আসল যাচাই ব্যাকএন্ড করে। উল্টো দিকে রিডাইরেক্ট
 *  নেই — নাহলে বাতিল হওয়া কুকি নিয়ে infinite loop হতো।
 *  `sf_refresh` নয়, `sf_session`: refresh কুকির path `/api/auth`, তাই পেজ
 *  রিকোয়েস্টে ব্রাউজার সেটা পাঠায়ই না।)
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedPath(pathname)) return NextResponse.next();

  // Value check, not mere presence: `has()` would also accept the empty string
  // left behind by a `maxAge: 0` clear. Mirrors `hasSessionHint()` in
  // `lib/api/session.ts`, so server and client agree on what "signed in" means.
  if (request.cookies.get(SESSION_HINT_COOKIE)?.value === '1') return NextResponse.next();

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
