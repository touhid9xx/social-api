import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Presence — `src/social_api/modules/presence/router.py`.
 *
 * The answer is a Redis counter with a TTL refreshed by the socket heartbeat,
 * which shapes what the UI can honestly claim:
 *
 *  1. It is PULLED, not pushed. The socket's `presence` envelope carries the
 *     TYPING event, not an online/offline transition — the contract has no
 *     "user went offline" frame. So an avatar dot is only as fresh as its last
 *     fetch; see `staleTime` in `hooks/use-presence.ts`.
 *  2. `online` is `connections > 0`, and a second tab counts twice. The count is
 *     exposed but nothing in this UI needs it, so it is not surfaced.
 *  3. Offline is not an error: an expired key answers
 *     `{ online: false, connections: 0 }`, so a grey dot is a real answer and
 *     never a failed request.
 *
 * Auth is required (the endpoint depends on `CurrentUser`), so this must not be
 * called before a token exists — the hook gates on `undefined` instead.
 */
export type PresenceView = components['schemas']['PresenceView'];

export async function getPresence(userId: number): Promise<PresenceView> {
  return apiRequest(() =>
    apiClient.GET('/api/v1/presence/{user_id}', {
      params: { path: { user_id: userId } },
    }),
  );
}
