'use client';

import { useEffect, useRef } from 'react';

import { getAccessToken, markBootstrapped, restoreSession } from '@/lib/api';

/**
 * Reload bootstrap.
 *
 * The access token lives in memory, so a page reload starts signed out even
 * though the httpOnly refresh cookie is still there. This component asks the
 * session layer to re-mint the token once on mount — but only when the
 * readable `sf_session` hint says a refresh cookie exists, so anonymous
 * visitors never pay for a guaranteed-401 round trip.
 *
 * Whatever the outcome, it then marks the store `bootstrapped` so the session
 * guard can stop waiting and make a decision. Without that flag the guard
 * cannot distinguish "not restored yet" from "restored, nobody there".
 *
 * Renders nothing; resident in the root layout.
 *
 * (রিলোডে টোকেন মেমোরি থেকে মুছে যায় — এই কম্পোনেন্টটা কুকি থেকে সেশন ফিরিয়ে আনে,
 *  আর শেষে `bootstrapped` সেট করে যাতে গার্ড সিদ্ধান্ত নিতে পারে।)
 */
export function SessionBootstrap() {
  // Mount-only. Sign-out clears the token on purpose, and re-running the
  // bootstrap at that moment would re-mint it from a cookie the logout route
  // has not necessarily cleared yet — silently undoing the sign-out.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (getAccessToken()) {
      markBootstrapped();
      return;
    }

    void restoreSession().finally(markBootstrapped);
  }, []);

  return null;
}
