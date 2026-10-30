import { create } from 'zustand';

import type { components } from '@/types/api';

/**
 * Session token store.
 *
 * Only the SHORT-LIVED access token lives here, and only in memory: no
 * `persist` middleware, nothing in `localStorage`/`sessionStorage`, nothing in
 * a JS-readable cookie. An XSS payload therefore cannot lift a credential that
 * outlives the tab.
 *
 * The long-lived refresh token is not here at all. Immediately after login the
 * browser hands it to `POST /api/auth/session`
 * (`src/app/api/auth/session/route.ts`), which parks it in an httpOnly cookie
 * scoped to `/api/auth`. A reload re-mints the access token through
 * `POST /api/auth/refresh` — that is why the session now survives F5.
 *
 * (refresh token কখনোই JS-এ থাকে না — শুধু httpOnly কুকিতে, তাই রিলোডেও সেশন টেকে।)
 */

/** Flat token envelope, straight from the generated contract. */
export type AuthTokens = components['schemas']['AuthTokens'];

/** What the browser keeps. No refresh token on purpose — see above. */
export type SessionTokens = {
  accessToken: string;
};

type SessionState = {
  accessToken: string | null;
};

/**
 * React-facing store. Components should read `useSessionStore` (e.g. to render
 * "signed in" state); the API layer below uses the plain accessors instead so
 * it never has to run inside a React render.
 */
export const useSessionStore = create<SessionState>(() => ({
  accessToken: null,
}));

export function getAccessToken(): string | null {
  return useSessionStore.getState().accessToken;
}

/** `null` when signed out. */
export function getTokens(): SessionTokens | null {
  const accessToken = getAccessToken();
  return accessToken ? { accessToken } : null;
}

export function setAccessToken(accessToken: string): void {
  useSessionStore.setState({ accessToken });
}

export function clearTokens(): void {
  useSessionStore.setState({ accessToken: null });
}
