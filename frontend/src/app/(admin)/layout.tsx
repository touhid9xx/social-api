import type { ReactNode } from 'react';

import { AppShell } from '@/components/shared/app-shell';

/**
 * Layout for the staff area (`admin`, `admin/users`, `admin/reports`,
 * `admin/audit`).
 *
 * Reuses `AppShell` so the admin group gets the same sign-out control and
 * session guard. Staff-only authorization is NOT decided here — the backend
 * answers `ADMIN_REQUIRED`/403 and the screens surface that — so this layout
 * stays a presentation shell rather than pretending to be an RBAC boundary.
 *
 * (স্টাফ-অনলি অনুমতি ব্যাকএন্ডে নির্ধারিত হয়; এখানে শুধু একই শেল আর গার্ড।)
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
