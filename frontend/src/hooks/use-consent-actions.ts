'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-keys';
import { type ConsentChannel, grantConsent, revokeConsent } from '@/lib/api/users';

/**
 * Grant / revoke a consent channel.
 *
 * Deliberately NOT optimistic, unlike the follow and like toggles. A consent row
 * is evidence: the backend stamps it with the caller's IP and user-agent, so the
 * server's answer is the only true one. Painting the switch green before that
 * answer arrives would show the user a legal record that does not exist yet.
 *
 * Both writes are idempotent server-side (`grant` upserts, `revoke` deletes), so
 * the switch is safe to re-click — hence no desired-state plumbing like
 * `useToggleFollow` needs. The mutation only has to say which channel and which
 * direction, which it does by choosing the function.
 *
 * The list is invalidated rather than patched: the response carries no row (201
 * message / 204 empty), so there is nothing to merge.
 */
export function useGrantConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channel: ConsentChannel) => grantConsent(channel),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.consents() });
    },
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channel: ConsentChannel) => revokeConsent(channel),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users.consents() });
    },
  });
}
