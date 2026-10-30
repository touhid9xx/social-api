import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';
import { REFRESH_COOKIE, SESSION_HINT_COOKIE } from '@/lib/session-constants';

/**
 * The session gate's cookie choice, pinned as a behavioural test.
 *
 * This gate used to key off the httpOnly `sf_refresh` cookie. That cookie is
 * issued with `path=/api/auth`, so a browser NEVER sends it to `/home` or
 * `/profile/*` — every signed-in navigation was answered with a 307 back to
 * `/login`, and the app was unusable after signing in. The fix was to read the
 * root-pathed `sf_session` hint instead; the cases below fail loudly if anyone
 * switches it back, or "optimises" the hint away.
 *
 * (কুকির path মিলে না — তাই `sf_refresh` দিয়ে গেট করলে লগইন করার পরেও
 *  প্রতিটা পেজ `/login`-এ ফিরে যেত। এই টেস্টগুলো সেটাই আটকে রাখে।)
 */

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers: header ? { cookie: header } : {},
  });
}

function locationOf(response: Response): string | null {
  return response.headers.get('location');
}

describe('middleware session gate', () => {
  it('lets a signed-in request through on the hint cookie alone', () => {
    const response = middleware(request('/home', { [SESSION_HINT_COOKIE]: '1' }));

    expect(response.status).toBe(200);
    expect(locationOf(response)).toBeNull();
  });

  it('lets a signed-in request through on every protected prefix', () => {
    for (const path of ['/explore', '/profile/22', '/profile/22/followers', '/admin/reports']) {
      const response = middleware(request(path, { [SESSION_HINT_COOKIE]: '1' }));
      expect(response.status, path).toBe(200);
    }
  });

  it('does not treat the refresh cookie as a session, because a page never receives it', () => {
    // `path=/api/auth` keeps `sf_refresh` out of every page request, so it is
    // always absent here; the hint is the only usable signal. Both cookies are
    // set and cleared together, so a real browser cannot hold one without the
    // other.
    const response = middleware(request('/home', { [REFRESH_COOKIE]: 'anything' }));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('http://localhost:3000/login?next=%2Fhome');
  });

  it('redirects a signed-out visitor and remembers where they were headed', () => {
    const response = middleware(request('/profile/22'));

    expect(response.status).toBe(307);
    expect(locationOf(response)).toBe('http://localhost:3000/login?next=%2Fprofile%2F22');
  });

  it('keeps the query string of the blocked destination', () => {
    const response = middleware(request('/search?q=bangla'));

    expect(locationOf(response)).toBe('http://localhost:3000/login?next=%2Fsearch%3Fq%3Dbangla');
  });

  it('treats an expired-and-cleared hint (empty value) as signed out', () => {
    // `clearAuthCookies` writes an empty value with `maxAge: 0`; an emptiness
    // check that only tested presence would keep the gate open.
    const response = middleware(request('/home', { [SESSION_HINT_COOKIE]: '' }));

    expect(response.status).toBe(307);
  });

  it('ignores cookies on public routes instead of redirecting a stale session home', () => {
    for (const path of ['/', '/login', '/register', '/design-system']) {
      expect(middleware(request(path, { [SESSION_HINT_COOKIE]: '1' })).status, path).toBe(200);
      expect(middleware(request(path)).status, path).toBe(200);
    }
  });
});
