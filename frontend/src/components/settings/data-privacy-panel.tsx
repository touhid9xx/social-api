'use client';

import { Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCancelDeletion,
  useDeletionStatus,
  useExportData,
  useRequestDeletion,
} from '@/hooks/use-account-deletion';
import { errorMessageKey } from '@/lib/api';

/** Name the browser gives the downloaded archive (there is no server filename). */
const EXPORT_FILENAME = 'my-data.json';

/**
 * Hand the exported archive to the browser as a file download.
 *
 * `GET /gdpr/export` is served with `Content-Disposition`, but the response is
 * consumed through `apiRequest`, which returns the parsed body and drops the
 * headers — so the filename has to be supplied here.
 */
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Settings → Data & privacy: right of access and the deletion grace window.
 *
 * Two independent halves, because the backend splits them too: the export lives
 * on `/gdpr/*` and is rate-limited to one call a minute, while the deletion is
 * requested through `DELETE /users/me` but inspected and cancelled through
 * `/gdpr/*`. The status read is mounted here (not in the settings page) so the
 * scheduled/cancellable panel is driven by the server rather than by whatever
 * this tab happens to remember.
 *
 * Deletion is confirmed through a dialog: the endpoint soft-deletes immediately
 * and the account keeps signing in during the grace window, so an accidental
 * click is recoverable — but only if the user knows it happened.
 */
export function DataPrivacyPanel() {
  const t = useTranslations('settings.privacy');
  const tRoot = useTranslations();
  const format = useFormatter();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const status = useDeletionStatus();
  const exportData = useExportData();
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();

  const failure = [exportData, requestDeletion, cancelDeletion].find(
    (mutation) => mutation.isError,
  );

  function handleExport() {
    exportData.mutate(undefined, {
      onSuccess: (data) => {
        downloadJson(data, EXPORT_FILENAME);
        toast.success(t('exportReady'));
      },
    });
  }

  function handleConfirmDeletion() {
    requestDeletion.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(t('scheduledToast'));
      },
    });
  }

  function handleCancelDeletion() {
    cancelDeletion.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('cancelledToast'));
      },
    });
  }

  return (
    <div className="space-y-8">
      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(failure.error))}
        </div>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">{t('exportTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('exportBody')}</p>
        <Button
          type="button"
          variant="outline"
          disabled={exportData.isPending}
          onClick={handleExport}
        >
          {exportData.isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {exportData.isPending ? t('exporting') : t('exportAction')}
        </Button>
        <p className="text-micro text-muted-foreground">{t('exportRateLimit')}</p>
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h3 className="text-sm font-medium text-foreground">{t('deleteTitle')}</h3>

        {status.isPending ? (
          <div aria-busy="true" aria-live="polite" className="space-y-2">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-9 w-40" />
          </div>
        ) : status.isError || !status.data ? (
          <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-foreground">{t('statusErrorTitle')}</p>
            <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : status.data.scheduled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {status.data.scheduled_hard_delete_at
                ? t('scheduledBody', {
                    date: format.dateTime(new Date(status.data.scheduled_hard_delete_at), {
                      dateStyle: 'long',
                    }),
                  })
                : t('scheduledBodyNoDate')}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={cancelDeletion.isPending}
              onClick={handleCancelDeletion}
            >
              {cancelDeletion.isPending ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {cancelDeletion.isPending ? t('cancelling') : t('cancelAction')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('deleteBody')}</p>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="destructive">
                  {t('deleteAction')}
                </Button>
              </DialogTrigger>

              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('confirmTitle')}</DialogTitle>
                  <DialogDescription>{t('confirmBody')}</DialogDescription>
                </DialogHeader>

                <DialogFooter>
                  {/* A translated close, not `DialogFooter`'s hardcoded English
                      `showCloseButton` — this is a destructive confirm and both
                      answers must read the same language as the rest of the app. */}
                  <DialogClose asChild>
                    <Button type="button" variant="outline">
                      {t('confirmCancel')}
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={requestDeletion.isPending}
                    onClick={handleConfirmDeletion}
                  >
                    {requestDeletion.isPending ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : null}
                    {requestDeletion.isPending ? t('scheduling') : t('confirmAction')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </section>
    </div>
  );
}
