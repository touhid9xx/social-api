'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import type { AdminUserUpdate } from '@/lib/api/users';
import {
  activateAdminUser,
  deleteAdminUser,
  resendAdminVerification,
  updateAdminUser,
  verifyAdminUser,
} from '@/lib/api/users';

/**
 * The admin account writes, as mutations that agree on one thing:
 * the directory is the authority on what happened.
 *
 * Deliberately NOT optimistic — the same reasoning as `useUpdateReport`. The
 * server refuses writes for reasons a client cannot predict (acting on
 * yourself, removing the last admin, a race with another admin), and each
 * refusal has its own copy. Painting the new role before the server agrees
 * would show a lie on the screen and then silently revert it.
 *
 * So every mutation ends by invalidating `users.all` — a prefix, so it also
 * clears any `users.profile` detail entries that the changed row appears in.
 * The backend returns the re-read `AdminUserView` anyway; it is passed straight
 * to the caller for a success announcement, not written into the cache, because
 * a `DELETE` must also drop the row from every loaded page and only a refetch
 * knows how to do that consistently.
 */

function useInvalidateDirectory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
}

export type UpdateAdminUserVariables = {
  userId: number;
  /** Only the fields that actually changed — the body is `exclude_unset`. */
  changes: AdminUserUpdate;
};

/** `PATCH /users/{id}` — role, active flag, verified flag. */
export function useUpdateAdminUser() {
  const invalidate = useInvalidateDirectory();

  return useMutation({
    mutationFn: ({ userId, changes }: UpdateAdminUserVariables) => updateAdminUser(userId, changes),
    onSuccess: () => invalidate(),
  });
}

/** `POST /users/{id}/activate` — clears both `is_active` and `is_verified`. */
export function useActivateAdminUser() {
  const invalidate = useInvalidateDirectory();

  return useMutation({
    mutationFn: (userId: number) => activateAdminUser(userId),
    onSuccess: () => invalidate(),
  });
}

/**
 * `POST /users/{id}/verify` — vouch for the account by hand.
 *
 * The manual equivalent of the user clicking the emailed link: it flips only
 * `is_verified`, never `is_active`, so a suspended account stays suspended.
 * Idempotent, so a double-click is harmless.
 */
export function useVerifyAdminUser() {
  const invalidate = useInvalidateDirectory();

  return useMutation({
    mutationFn: (userId: number) => verifyAdminUser(userId),
    onSuccess: () => invalidate(),
  });
}

/**
 * `POST /users/{id}/resend-verification` — mail the account a fresh link.
 *
 * Changes no state on the server (the account stays unverified until the link
 * is clicked), but it still invalidates the directory: the row is unchanged, and
 * the refetch keeps the console honest if the user clicks while it is open.
 */
export function useResendAdminVerification() {
  const invalidate = useInvalidateDirectory();

  return useMutation({
    mutationFn: (userId: number) => resendAdminVerification(userId),
    onSuccess: () => invalidate(),
  });
}

/**
 * `DELETE /users/{id}` — soft-delete.
 *
 * Reversible by design: it sets `deleted_at` + `is_active` and schedules no
 * GDPR hard delete, so the same account can be brought back with `activate`.
 */
export function useDeleteAdminUser() {
  const invalidate = useInvalidateDirectory();

  return useMutation({
    mutationFn: (userId: number) => deleteAdminUser(userId),
    onSuccess: () => invalidate(),
  });
}
