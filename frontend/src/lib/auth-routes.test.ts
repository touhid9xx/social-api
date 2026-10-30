import { describe, expect, it } from 'vitest';

import { config } from '@/middleware';

import { ROUTES } from './constants';
import {
  isAuthPage,
  isProtectedPath,
  postSignInPath,
  PROTECTED_PREFIXES,
  safeNextPath,
  signInPath,
} from './auth-routes';

/**
 * The session gate's decision logic, plus the invariants that keep the two
 * halves (`middleware.ts` and the client guard) from drifting apart.
 *
 * The `safeNextPath` / `postSignInPath` cases are security tests, not style
 * tests: every rejected input below would otherwise let an attacker turn
 * `/login` into a redirect off this origin.
 *
 * (নিচের rejected ইনপুটগুলোই open redirect ঠেকায় — এগুলো ফাংশনাল টেস্ট নয়, সিকিউরিটি টেস্ট।)
 */

describe('isProtectedPath', () => {
  it('protects every declared prefix and everything beneath it', () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(isProtectedPath(prefix)).toBe(true);
      expect(isProtectedPath(`${prefix}/nested`)).toBe(true);
    }
  });

  it('protects the dynamic detail routes', () => {
    expect(isProtectedPath('/posts/42')).toBe(true);
    expect(isProtectedPath('/profile/alice')).toBe(true);
    expect(isProtectedPath('/admin/users')).toBe(true);
  });

  it('leaves the public routes alone', () => {
    for (const path of [
      '/',
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/verify-email',
      '/design-system',
    ]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it('matches on a segment boundary, not a bare string prefix', () => {
    expect(isProtectedPath('/homely')).toBe(false);
    expect(isProtectedPath('/administrator')).toBe(false);
    expect(isProtectedPath('/messages-archive')).toBe(false);
    expect(isProtectedPath('/settings-backup')).toBe(false);
  });

  it('treats a trailing slash as inside the prefix', () => {
    expect(isProtectedPath('/home/')).toBe(true);
  });

  it('treats an empty path as the landing page', () => {
    expect(isProtectedPath('')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps a valid internal path, query string included', () => {
    expect(safeNextPath('/explore')).toBe('/explore');
    expect(safeNextPath('/posts/42?tab=comments')).toBe('/posts/42?tab=comments');
  });

  it('falls back to home for an absolute URL', () => {
    expect(safeNextPath('https://evil.example')).toBe(ROUTES.home);
    expect(safeNextPath('javascript:alert(1)')).toBe(ROUTES.home);
  });

  it('rejects the protocol-relative form', () => {
    expect(safeNextPath('//evil.example')).toBe(ROUTES.home);
  });

  it('rejects the backslash trick browsers normalise into //', () => {
    expect(safeNextPath('/\\evil.example')).toBe(ROUTES.home);
    expect(safeNextPath('/\t/evil.example')).toBe(ROUTES.home);
  });

  it('rejects a relative path with no leading slash', () => {
    expect(safeNextPath('home')).toBe(ROUTES.home);
    expect(safeNextPath('../admin')).toBe(ROUTES.home);
  });

  it('rejects control characters', () => {
    expect(safeNextPath('/home\nSet-Cookie: x')).toBe(ROUTES.home);
  });

  it('falls back on an empty or missing value', () => {
    expect(safeNextPath(null)).toBe(ROUTES.home);
    expect(safeNextPath(undefined)).toBe(ROUTES.home);
    expect(safeNextPath('')).toBe(ROUTES.home);
  });

  it('honours an explicit fallback', () => {
    expect(safeNextPath(null, ROUTES.explore)).toBe(ROUTES.explore);
  });
});

describe('signInPath', () => {
  it('encodes the page the visitor was trying to reach', () => {
    expect(signInPath('/settings')).toBe('/login?next=%2Fsettings');
    expect(signInPath('/posts/42?tab=comments')).toBe(
      `/login?next=${encodeURIComponent('/posts/42?tab=comments')}`,
    );
  });

  it('degrades to a bare /login for a missing or unsafe target', () => {
    expect(signInPath(null)).toBe(ROUTES.login);
    expect(signInPath(undefined)).toBe(ROUTES.login);
    expect(signInPath('https://evil.example')).toBe(ROUTES.login);
    expect(signInPath('//evil.example')).toBe(ROUTES.login);
  });
});

describe('postSignInPath', () => {
  it('returns the requested internal page', () => {
    expect(postSignInPath('/settings')).toBe('/settings');
    expect(postSignInPath('/posts/42')).toBe('/posts/42');
  });

  it('falls back to home when there is nothing to return to', () => {
    expect(postSignInPath(null)).toBe(ROUTES.home);
    expect(postSignInPath(undefined)).toBe(ROUTES.home);
    expect(postSignInPath('')).toBe(ROUTES.home);
    expect(postSignInPath('https://evil.example')).toBe(ROUTES.home);
    expect(postSignInPath('//evil.example')).toBe(ROUTES.home);
  });

  it('refuses to send the user back into an auth page', () => {
    for (const page of [ROUTES.login, ROUTES.register, ROUTES.resetPassword]) {
      expect(postSignInPath(page)).toBe(ROUTES.home);
    }
  });

  it('refuses an auth page even when a query string is attached', () => {
    expect(postSignInPath(`${ROUTES.login}?next=${encodeURIComponent(ROUTES.login)}`)).toBe(
      ROUTES.home,
    );
  });

  it('keeps a query string on a legitimate target', () => {
    expect(postSignInPath('/search?q=bangla')).toBe('/search?q=bangla');
  });
});

describe('isAuthPage', () => {
  it('recognises the session-acquisition screens', () => {
    expect(isAuthPage(ROUTES.login)).toBe(true);
    expect(isAuthPage(ROUTES.register)).toBe(true);
    expect(isAuthPage(ROUTES.forgotPassword)).toBe(true);
  });

  it('does not mistake an app route for one', () => {
    expect(isAuthPage(ROUTES.home)).toBe(false);
    expect(isAuthPage('/login/extra')).toBe(false);
  });
});

describe('middleware matcher', () => {
  it('runs on every protected prefix', () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(config.matcher).toContain(`${prefix}/:path*`);
    }
  });

  it('has exactly one entry per protected prefix, so they stay in lockstep', () => {
    expect(config.matcher).toHaveLength(PROTECTED_PREFIXES.length);
  });

  it('never runs on a public route or on the auth/API endpoints', () => {
    for (const path of ['/login', '/register', '/design-system', '/api/auth/refresh', '/']) {
      expect(config.matcher).not.toContain(path);
      expect(config.matcher.some((entry) => path.startsWith(entry.replace('/:path*', '')))).toBe(
        false,
      );
    }
  });
});
