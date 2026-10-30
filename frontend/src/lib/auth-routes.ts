import { ROUTES } from './constants';

/**
 * Which routes need a session, and where to send the ones that do not have one.
 *
 * Framework-agnostic on purpose: `src/middleware.ts` runs on the Edge runtime
 * and the client guard (`components/shared/require-session.tsx`) runs in the
 * browser, so this module must not import `next/server`, `next/navigation` or
 * anything DOM-only.
 *
 * (একই নিয়ম সার্ভার মিডলওয়্যার আর ক্লায়েন্ট গার্ড — দুই জায়গাতেই ব্যবহার হয়,
 *  তাই এখানে কোনো framework ইমপোর্ট নেই।)
 */

/**
 * Route prefixes that require a session. Everything else — the landing page,
 * the design system, the auth screens — is public.
 *
 * Admin is included deliberately: RBAC is enforced by the backend (an admin
 * route answered 403 means "signed in but not staff"), but a signed-out visitor
 * should still be turned away before the page renders.
 */
export const PROTECTED_PREFIXES = [
  ROUTES.home,
  ROUTES.explore,
  ROUTES.notifications,
  ROUTES.messages,
  ROUTES.search,
  ROUTES.settings,
  ROUTES.posts,
  ROUTES.profile,
  ROUTES.admin,
] as const;

/** Screens that exist to acquire a session; landing on one after signing in is a loop. */
export const AUTH_PAGES = [
  ROUTES.login,
  ROUTES.register,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.verifyEmail,
] as const;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Prefix match on a segment boundary, so `/homely` is NOT protected by `/home`
 * and `/admin` does not accidentally cover an unrelated `/administrator`.
 */
export function isProtectedPath(pathname: string): boolean {
  const path = pathname || '/';

  return PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(pathname);
}

/**
 * Resolve a user-supplied `?next=` value to an internal path, or `null`.
 *
 * This is an open-redirect guard, not a formality: `router.replace()` happily
 * follows an absolute URL, so without this check `/login?next=https://evil.example`
 * would turn the sign-in screen into a phishing hop that leaves our origin.
 *
 * Rejected: anything not starting with `/`, protocol-relative `//host`,
 * backslashes (browsers normalise `/\host` to `//host`), control characters,
 * and anything whose parsed origin escapes the placeholder base.
 */
function internalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\') || CONTROL_CHARACTERS.test(raw)) return null;

  try {
    // Any absolute base works: the only thing under test is whether `raw`
    // resolves to the SAME origin or tries to escape it.
    const base = 'http://internal.invalid';
    return new URL(raw, base).origin === base ? raw : null;
  } catch {
    return null;
  }
}

/** `raw` when it is a safe internal path, otherwise `fallback` (home). */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = ROUTES.home,
): string {
  return internalPath(raw) ?? fallback;
}

/** Where to send a signed-out user, remembering where they were headed. */
export function signInPath(next?: string | null): string {
  const target = internalPath(next);
  return target ? `${ROUTES.login}?next=${encodeURIComponent(target)}` : ROUTES.login;
}

/**
 * Where to go after a successful sign-in: the safe `?next=` target, or home.
 *
 * Auth pages are excluded so `/login?next=/login` cannot bounce the user
 * straight back into a screen they have just finished with.
 */
export function postSignInPath(next: string | null | undefined): string {
  const target = internalPath(next);
  if (!target) return ROUTES.home;

  // Compare only the path: `?next=/login?x=1` carries a query string, and
  // `isAuthPage` matches on an exact pathname.
  const pathname = target.split(/[?#]/, 1).at(0) ?? target;
  return isAuthPage(pathname) ? ROUTES.home : target;
}
