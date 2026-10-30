import type { ReactNode } from 'react';

import { AppShell } from '@/components/shared/app-shell';

/**
 * Layout for the signed-in app (`home`, `explore`, `notifications`, `messages`,
 * `search`, `settings`, `posts/[id]`, `profile/[id]`).
 *
 * Thin on purpose: all of the shell and the session guard lives in `AppShell`
 * so the `(admin)` group can reuse it byte for byte and the two can never drift.
 *
 * (আসল শেল আর গার্ড `AppShell`-এ; এখানে শুধু গ্রুপের সাথে জুড়ে দেওয়া।)
 */
export default function MainLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
