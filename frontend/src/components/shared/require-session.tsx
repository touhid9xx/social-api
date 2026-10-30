'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { useSessionStore } from '@/lib/api';
import { signInPath } from '@/lib/auth-routes';

/**
 * Client-side session guard for the protected route groups.
 *
 * Handles the case the middleware cannot: the refresh cookie is still present
 * but no longer usable (expired, revoked, or the account was closed). The
 * browser then finishes the reload bootstrap with no access token, and this
 * component sends the user to `/login?next=<where they were>` instead of
 * leaving a broken, silently-empty page on screen.
 *
 * Three states, and all three matter:
 *   - `bootstrapped === false` -> still restoring; render the pending state and
 *     do NOT redirect, or every reload of a signed-in page would flash /login.
 *   - token present             -> render the page.
 *   - bootstrapped && no token  -> signed out; redirect, and render nothing
 *     protected while that navigation is in flight.
 *
 * (রিলোডে টোকেন ফেরত পাওয়ার আগেই রিডাইরেক্ট করলে সাইন-ইন করা পেজ বারবার
 *  /login-এ লাফাত — তাই `bootstrapped` আসা পর্যন্ত অপেক্ষা করা হয়।)
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const t = useTranslations('auth.session');
  const accessToken = useSessionStore((state) => state.accessToken);
  const bootstrapped = useSessionStore((state) => state.bootstrapped);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!bootstrapped || accessToken) return;
    // `replace`, not `push`: the expired page must not come back on Back.
    router.replace(signInPath(pathname));
  }, [accessToken, bootstrapped, pathname, router]);

  if (accessToken) return <>{children}</>;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <span>{t('restoring')}</span>
    </div>
  );
}
