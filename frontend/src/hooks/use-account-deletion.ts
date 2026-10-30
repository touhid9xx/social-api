'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  cancelDeletion,
  type DeletionStatus,
  exportMyData,
  getDeletionStatus,
} from '@/lib/api/gdpr';
import { queryKeys } from '@/lib/api/query-keys';
import { deleteMe } from '@/lib/api/users';

/**
 * The deletion grace window, both sides of it.
 *
 * `DELETE /users/me` returns `hard_delete_after` and nothing else useful, so the
 * status cache is seeded from that response instead of refetched: the deleted
 * account's session is already on its way out, and a follow-up request would be
 * the one most likely to 401 and blank the panel that is trying to show the user
 * how to undo the deletion.
 *
 * `cancel` is the only write that refreshes the status, because the server's new
 * answer (`none`, or a fresh schedule) is not derivable from the response.
 */
export function useDeletionStatus() {
  return useQuery({
    queryKey: queryKeys.gdpr.deletionStatus(),
    queryFn: getDeletionStatus,
    staleTime: 60_000,
  });
}

export function useRequestDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteMe,

    onSuccess: (result) => {
      queryClient.setQueryData<DeletionStatus>(queryKeys.gdpr.deletionStatus(), {
        scheduled: true,
        scheduled_hard_delete_at: result.hard_delete_after,
        status: 'scheduled',
      });
    },
  });
}

export function useCancelDeletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelDeletion,

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gdpr.deletionStatus() });
    },
  });
}

/**
 * Right of access. The endpoint is a 1/minute JSON download, so it runs as a
 * mutation: the UI can disable the control while it is in flight, which is the
 * only thing standing between an impatient click and a real 429.
 */
export function useExportData() {
  return useMutation({ mutationFn: exportMyData });
}
