'use client';

import { useMutation } from '@tanstack/react-query';

import { changePassword } from '@/lib/api/auth';
import type { ChangePasswordValues } from '@/lib/validation/auth';

/**
 * Rotate the caller's password.
 *
 * Nothing is invalidated or patched on success: the backend blacklists the access
 * token this request arrived on, so the session is over by the time the promise
 * resolves. The caller signs out next — refetching user-scoped queries would only
 * fire requests with a token that no longer works.
 *
 * Not optimistic and not retried: the write either happened or it did not, and a
 * silent replay of a password change is the last thing anyone wants. Errors need
 * no special handling here — `errorMessageKey` already maps `INVALID_CREDENTIALS`
 * to `errors.invalidCredentials` for the form to render.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (values: ChangePasswordValues) => changePassword(values),
  });
}
