'use client';

import { useEffect } from 'react';

import { restoreSession, useSessionStore } from '@/lib/api';

/**
 * Reload bootstrap.
 *
 * The access token lives in memory, so a page reload starts signed out even
 * though the httpOnly refresh cookie is still there. This component asks the
 * session layer to re-mint the token once on mount — but only when the
 * readable `sf_session` hint says a refresh cookie exists, so anonymous
 * visitors never pay for a guaranteed-401 round trip.
 *
 * Renders nothing; resident in the root layout.
 *
 * (রিলোডে টোকেন মেমোরি থেকে মুছে যায় — এই কম্পোনেন্টটা কুকি থেকে সেশন ফিরিয়ে আনে।)
 */
export function SessionBootstrap() {
  const accessToken = useSessionStore((state) => state.accessToken);

  useEffect(() => {
    if (accessToken) return;
    void restoreSession();
  }, [accessToken]);

  return null;
}
