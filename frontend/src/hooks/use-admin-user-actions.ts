'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import type { AdminUserUpdate } from '@/lib/api/users';
import { activateAdminUser, deleteAdminUser, updateAdminUser } from '@/lib/api/users';

/**
 * The three admin account writes, as mutations that agree on one thing:
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
