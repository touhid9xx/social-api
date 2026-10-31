import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * Feature flags — `src/social_api/api/v1/flags.py`.
 *
 * Two endpoints, both admin-only (`require_roles(ADMIN)`), so a signed-in
 * non-admin gets `403 FORBIDDEN` and the screen has to treat that as an answer
 * rather than a broken request — `ProfileSelf` does not expose `role`, so the
 * client cannot pre-check.
 *
 *  - `GET  /flags`                     → `{ flags: [{ name, env_value, builtin_value }] }`
 *  - `POST /flags/{flag_name}/override` → set OR clear one user's override
 *
 * Two contract details worth keeping in the client:
 *
 * 1. **The list carries no override data.** `FlagView` has exactly three
 *    fields; `overridden_user_count` is intentionally absent because counting
 *    it SCANs the whole Redis keyspace per flag (`core/flags/provider.py:118`).
 *    So the table below can show env vs. builtin drift, and nothing more — and
 *    a write does NOT invalidate the list, because the list response cannot
 *    change as a result of it. The POST echoes the applied value instead
 *    (`FlagOverrideResponse`), which is what the UI reports back.
 *
 * 2. **No `Idempotency-Key`.** This route is not in the middleware's
 *    `_IDEMPOTENT_PATTERNS` (`modules/idempotency/middleware.py:30`), and
 *    semantically it is a state-set — repeating it with the same body lands on
 *    the same override, so a key would add a table write and buy nothing.
 *
 * `enabled: null` is not "missing": it means *clear the override*, so the flag
 * falls back to env → builtin. The response's `action` distinguishes `"set"`
 * from `"cleared"`, which is the only way to tell the two apart from a
 * `enabled: false` result.
 */

export type FlagView = components['schemas']['FlagView'];

export type FlagList = components['schemas']['FlagList'];

export type FlagOverride = components['schemas']['FlagOverride'];

export type FlagOverrideResponse = components['schemas']['FlagOverrideResponse'];

export async function getFlags(): Promise<FlagList> {
  return apiRequest(() => apiClient.GET('/api/v1/flags'));
}

/**
 * Set (`enabled: true|false`) or clear (`enabled: null`) one user's override.
 *
 * An unknown flag name is a `400 BAD_REQUEST` whose `detail` carries
 * `known_flags` — unreachable from the select, which is built from `GET /flags`,
 * but it is the server's answer if the two ever disagree.
 */
export async function setFlagOverride(
  flagName: string,
  payload: FlagOverride,
): Promise<FlagOverrideResponse> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/flags/{flag_name}/override', {
      params: { path: { flag_name: flagName } },
      body: payload,
    }),
  );
}
