import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { AppNav } from '@/components/shared/app-nav';
import { RequireSession } from '@/components/shared/require-session';
import { SignOutButton } from '@/components/shared/sign-out-button';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { ROUTES } from '@/lib/constants';

/**
 * Chrome shared by every signed-in screen: `(main)` and `(admin)`.
 *
 * Same header anatomy as `app/(auth)/layout.tsx` (brand link, 16rem/`h-16` bar,
 * `max-w-6xl`) so moving between the landing page, the auth screens and the app
 * is not a change of application.
 *
 * Only the session-dependent part is gated. The header itself is server-rendered
 * chrome and stays on screen while `RequireSession` redirects, so a user signing
 * out is not left staring at a blank window. `id="main"` sits OUTSIDE the guard
 * so the root layout's skip-link target still exists in every state.
 *
 * (হেডার সবসময় থাকে; শুধু ভেতরের কনটেন্ট সেশন-নির্ভর। skip-link-এর টার্গেট
 *  গার্ডের বাইরে রাখা হয়েছে যাতে সব অবস্থাতেই থাকে।)
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('app');

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href={ROUTES.home} className="flex items-center gap-2 font-semibold">
              <span
                aria-hidden="true"
                className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
              >
                S
              </span>
              {/* The wordmark is the first thing to go on a narrow screen: the
                  logo still links home, and the nav needs the room more. */}
              <span className="hidden text-foreground sm:inline">{t('name')}</span>
            </Link>

            <AppNav />
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col">
        <RequireSession>{children}</RequireSession>
      </main>
    </div>
  );
}
