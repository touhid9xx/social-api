'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { endSession } from '@/lib/api';
import { ROUTES } from '@/lib/constants';

/**
 * Sign-out control for the app shell.
 *
 * `endSession()` clears the in-memory token FIRST, then revokes server-side on a
 * best-effort basis and drops both cookies — so the local session is gone even
 * if the network is down. Nothing here can throw, which is why there is no
 * error state: a user who asks to sign out must never stay signed in because an
 * API call failed.
 *
 * The React Query cache is cleared before navigating. It is keyed by resource,
 * not by user, so leaving it populated would show the next account on this
 * device the previous account's cached feed.
 *
 * (সাইন আউট সবসময় সফল হয় — নেটওয়ার্ক ব্যর্থ হলেও লোকাল সেশন মুছে যায়;
 *  ক্যাশও পরিষ্কার করা হয় যাতে পরের অ্যাকাউন্ট আগের ডেটা না দেখে।)
 */
export function SignOutButton() {
  const t = useTranslations('auth.session');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await endSession();
      queryClient.clear();
      // `replace`, not `push`: the signed-in page must not remain in history.
      router.replace(ROUTES.login);
      // Drop the server-rendered output too — it was produced with the cookie.
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const label = pending ? t('signingOut') : t('signOut');

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      disabled={pending}
      aria-label={label}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <LogOut aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
