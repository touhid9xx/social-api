'use client';

import { useQuery } from '@tanstack/react-query';

import { getAuthMe, type UserRole } from '@/lib/api/auth';
import { queryKeys } from '@/lib/api/query-keys';
import { useSessionStore } from '@/lib/api/tokens';

/**
 * The signed-in user's own role — the only way the client can tell staff apart.
 *
 * `GET /users/me` returns `ProfileSelf`, which has no `role` field, so `useMe`
 * cannot answer "may this account see the staff console". `GET /auth/me` returns
 * `UserPublic`, which is id/role/is_active/is_verified/created_at and nothing
 * else. That is the request made here, under `queryKeys.auth.me()` — a key that
 * existed for this and had no consumer until now.
 *
 * Two things this must not be mistaken for:
 *
 *  - It is **not** an authorisation check. A role read from the network is only a
 *    hint for what to render; every staff route re-checks the role server-side
 *    (`require_roles`), and a forged or stale answer here buys a 403, not access.
 *  - It is not a second `/users/me`. They answer different questions, carry
 *    different data and live in different cache families, so neither can serve
 *    the other's screen.
 *
 * `enabled` on an access token because the shell (and therefore `UserMenu`)
 * renders outside `RequireSession`: without a token this read would be a
 * guaranteed 401 on the landing page and every sign-in screen. `staleTime` is
 * long — a promotion mid-session is not worth polling for, and the next reload
 * picks it up.
 */
export function useMyRole(): UserRole | undefined {
  const accessToken = useSessionStore((state) => state.accessToken);

  const { data } = useQuery({
    queryKey: queryKeys.auth.me(),
    queryFn: getAuthMe,
    enabled: Boolean(accessToken),
    staleTime: 5 * 60_000,
  });

  return data?.role;
}
