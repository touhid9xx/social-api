'use client';

import { Flag, Loader2, ShieldOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/use-author';
import { useInView } from '@/hooks/use-in-view';
import { useReports, useUpdateReport } from '@/hooks/use-reports';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import {
  REPORT_STATUSES,
  REPORT_TRANSITIONS,
  type ReportStatus,
  type ReportView,
} from '@/lib/api/moderation';
import { formatRelativeTime } from '@/lib/format';

/**
 * The moderation report queue — [contracts/api_reference.md:2938].
 *
 * Three contract facts shape this screen:
 *
 *  1. **The caller's role is unknowable here.** `ProfileSelf` has no `role`
 *     field, so there is no client-side gate to consult. The screen renders and
 *     lets a `403` explain itself; `query-provider.tsx` skips 4xx retries, so
 *     that settles in one request rather than a retry storm.
 *  2. **Every write is optimistic-locked on `version`.** The row sends the
 *     version it was *rendered* at, so two moderators working the same queue
 *     cannot silently overwrite each other. A `409 VERSION_CONFLICT` is not an
 *     error to apologise for — it means "this row moved", so the fix offered is
 *     a reload, not a retry.
 *  3. **Resolved and dismissed are terminal.** The backend accepts a repeat of
 *     the same status as an idempotent no-op and raises `REPORT_LOCKED` for any
 *     other, so a closed row shows its decision instead of dead buttons.
 *
 * The transition buttons come from `REPORT_TRANSITIONS` (the contract's
 * writable set, which excludes `open` — a report cannot be reopened), minus the
 * row's current status, which would only be a no-op.
 */

/** `open` sorts first so the queue reads as a worklist, not an archive. */
const STATUS_BADGE: Record<ReportStatus, 'destructive' | 'secondary' | 'outline' | 'ghost'> = {
  open: 'destructive',
  under_review: 'secondary',
  resolved: 'outline',
  dismissed: 'ghost',
};

/** No Select primitive exists in `components/ui`; this matches the native ones. */
const FILTER_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

function isTerminal(status: ReportStatus): boolean {
  return status === 'resolved' || status === 'dismissed';
}

function ReportSkeleton() {
  const t = useTranslations('admin.reports');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-8 w-32" />
        </div>
      ))}
    </div>
  );
}

function ReportRow({ report, onReload }: { report: ReportView; onReload: () => void }) {
  const t = useTranslations('admin.reports');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { data: reporter } = useAuthor(report.reporter_id);
  const update = useUpdateReport();
  const [note, setNote] = useState('');

  const terminal = isTerminal(report.status);
  const reporterName =
    reporter?.display_name?.trim() || t('reporterFallback', { id: report.reporter_id });
  const available = REPORT_TRANSITIONS.filter((status) => status !== report.status);

  const conflict = isAppApiError(update.error) && update.error.status === 409;

  const noteId = `report-note-${String(report.id)}`;

  function transition(status: (typeof REPORT_TRANSITIONS)[number]) {
    const trimmed = note.trim();

    update.mutate(
      {
        reportId: report.id,
        version: report.version,
        status,
        resolutionNote: trimmed === '' ? null : trimmed,
      },
      {
        onSuccess: () => setNote(''),
        onError: (error) => {
          // A conflict is shown inline with a reload action instead — a toast
          // would vanish while the moderator is still reading the row.
          if (!(isAppApiError(error) && error.status === 409)) {
            toast.error(tRoot(errorMessageKey(error)));
          }
        },
      },
    );
  }

  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_BADGE[report.status]}>{t(`status.${report.status}`)}</Badge>
        <Badge variant="outline">{t(`reason.${report.reason}`)}</Badge>
        <span className="text-sm font-medium text-foreground">
          {t('targetLine', { target: t(`target.${report.target_type}`), id: report.target_id })}
        </span>
        <time
          dateTime={report.created_at}
          className="ml-auto text-xs text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(report.created_at, locale)}
        </time>
      </div>

      <p className="text-micro text-muted-foreground">{t('reportedBy', { name: reporterName })}</p>

      {report.details ? (
        <p className="text-sm text-pretty text-foreground">{report.details}</p>
      ) : (
        <p className="text-micro text-muted-foreground">{t('noDetails')}</p>
      )}

      {report.resolution_note ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          <span className="block text-micro text-muted-foreground">{t('resolutionLabel')}</span>
          {report.resolution_note}
        </p>
      ) : null}

      {report.resolved_at ? (
        <p className="text-micro text-muted-foreground">
          {t('resolvedAt', { time: formatRelativeTime(report.resolved_at, locale) })}
        </p>
      ) : null}

      {update.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{conflict ? t('conflict') : tRoot(errorMessageKey(update.error))}</span>
          {conflict ? (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              {t('reload')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {terminal ? (
        <p className="text-micro font-medium text-muted-foreground">{t('locked')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label htmlFor={noteId} className="text-micro font-medium text-foreground">
              {t('noteLabel')}
            </label>
            <input
              id={noteId}
              name="resolution_note"
              value={note}
              maxLength={500}
              placeholder={t('notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
              disabled={update.isPending}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {available.map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={status === 'dismissed' ? 'outline' : 'default'}
                disabled={update.isPending}
                onClick={() => transition(status)}
              >
                {update.isPending && update.variables?.status === status ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : null}
                {t(`transition.${status}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export function ReportList() {
  const t = useTranslations('admin.reports');
  const [status, setStatus] = useState<ReportStatus | null>(null);

  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isFetchNextPageError,
  } = useReports({ status });

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const items = data ? data.pages.flatMap((page) => page.items) : [];

  const filter = (
    <div className="flex items-center gap-2">
      <label htmlFor="report-status-filter" className="text-xs text-muted-foreground">
        {t('filterLabel')}
      </label>
      <select
        id="report-status-filter"
        value={status ?? 'all'}
        onChange={(event) => {
          const next = event.target.value;
          setStatus(isReportStatus(next) ? next : null);
        }}
        className={FILTER_CLASS}
      >
        <option value="all">{t('allStatuses')}</option>
        {REPORT_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`status.${value}`)}
          </option>
        ))}
      </select>
    </div>
  );

  // 403 is the only branch worth naming: the queue is staff-only and the
  // frontend cannot know the caller's role, so this is the expected outcome for
  // a signed-in non-moderator rather than a failure.
  if (isError && isAppApiError(error) && error.status === 403) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6 text-center">
        <ShieldOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('staffOnlyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('staffOnlyBody')}</p>
      </div>
    );
  }

  if (isPending) return <ReportSkeleton />;

  if (isError && items.length === 0) {
    return (
      <div
        role="alert"
        className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <h2 className="text-base font-semibold text-foreground">{t('errorTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('errorBody')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        {filter}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <Flag aria-hidden="true" className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('count', { count: items.length })}</p>
        {filter}
      </div>

      <ul className="space-y-3">
        {items.map((report) => (
          <ReportRow key={report.id} report={report} onReload={() => void refetch()} />
        ))}
      </ul>

      {hasNextPage ? (
        <div className="space-y-3">
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

          <div className="flex flex-col items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void fetchNextPage()}
              disabled={!canLoadMore}
              aria-busy={isFetchingNextPage}
            >
              {isFetchingNextPage ? t('loadingMore') : t('loadMore')}
            </Button>

            {isFetchNextPageError ? (
              <p role="alert" className="text-xs text-destructive">
                {t('loadMoreFailed')}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-muted-foreground">{t('endOfList')}</p>
      )}
    </div>
  );
}
