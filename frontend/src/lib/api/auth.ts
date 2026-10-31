import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * The authenticated half of the auth API — the flows that need a bearer token.
 *
 * Sign-in, registration and the emailed reset link are deliberately NOT here:
 * they mint credentials, so they are called from the route handlers / forms that
 * own the session (`./session.ts`), not from the shared client helpers.
 */

export type ChangePasswordBody = components['schemas']['ChangePasswordRequest'];

export type MessageResponse = components['schemas']['MessageResponse'];

/**
 * `GET /api/v1/auth/me` — the caller's identity **including `role`**.
 *
 * Deliberately not the same call as `GET /users/me` (`./users.ts`): that one
 * returns `ProfileSelf` with the owner's PII and no `role` field at all, so it
 * cannot answer "may I see the staff console". This endpoint returns
 * `UserPublic`, which is id/role/is_active/is_verified/created_at and nothing
 * else — the one place the client can learn its own role.
 */
export type UserRole = components['schemas']['UserPublic']['role'];

export async function getAuthMe(): Promise<components['schemas']['UserPublic']> {
  return apiRequest(() => apiClient.GET('/api/v1/auth/me'));
}

/**
 * `POST /api/v1/auth/change-password` — rotate the caller's own password.
 *
 * The bearer token proves *who* is calling; `current_password` proves the caller
 * owns the account. A wrong current password answers 401 `INVALID_CREDENTIALS`,
 * which is why the path is listed in `NO_RETRY_PATHS` in `./client.ts`: that 401
 * is an answer about the password, not an expired session, so the client must
 * surface it instead of refreshing and replaying.
 *
 * The route blacklists the access token this call arrived on, so the caller is
 * signed out by design — hence no tokens in the response, only a message.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<MessageResponse> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/auth/change-password', {
      body: {
        current_password: input.currentPassword,
        new_password: input.newPassword,
      },
    }),
  );
}
