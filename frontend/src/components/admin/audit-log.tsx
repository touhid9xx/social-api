'use client';

import { ScrollText, ShieldOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useAuthor } from '@/hooks/use-author';
import { useInView } from '@/hooks/use-in-view';
import { isAppApiError } from '@/lib/api';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  type AuditAction,
  type AuditEntity,
  type AuditLogView,
} from '@/lib/api/audit';
import { formatRelativeTime } from '@/lib/format';

/**
 * The admin audit trail — [contracts/api_reference.md:17].
 *
 * `GET /audit` is admin-only (`require_roles(ADMIN)`), so exactly like the
 * report queue the frontend cannot pre-check the role and a `403` is a normal
 * outcome rather than a bug.
 *
 * `before`/`after` are already PII-redacted server-side at write time, so they
 * are safe to render verbatim — but they are machine payloads, not copy, which
 * is why they live behind a `<details>` as JSON instead of being turned into
 * sentences. Nothing here tries to translate an `action`: the audit log is an
 * operational record, and inventing display names for 16 actions would drift
 * from the enum the backend actually wrote.
 */

/** No Select primitive exists in `components/ui`; this matches the native ones. */
const FILTER_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

function isAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isEntity(value: string): value is AuditEntity {
  return (AUDIT_ENTITIES as readonly string[]).includes(value);
}

function AuditSkeleton() {
  const t = useTranslations('admin.audit');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="space-y-2 rounded-lg border border-border bg-card p-3">
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function AuditRow({ log }: { log: AuditLogView }) {
  const t = useTranslations('admin.audit');
  const locale = useLocale();
  // `actor_id` is nullable: system-written rows have no actor, and `useAuthor`
  // takes `undefined` to mean "no id yet, don't fetch".
  const { data: actor } = useAuthor(log.actor_id ?? undefined);

  const actorName =
    log.actor_id === null
      ? t('systemActor')
      : (actor?.display_name?.trim() ?? t('actorFallback', { id: log.actor_id }));

  const payload = [
    log.before ? { key: 'before', value: log.before } : null,
    log.after ? { key: 'after', value: log.after } : null,
  ].filter(
    (entry): entry is { key: 'before' | 'after'; value: Record<string, unknown> } => entry !== null,
  );

  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {log.action}
        </code>

        <span className="text-xs text-muted-foreground">
          {t('entityLine', { entity: log.entity, id: log.entity_id ?? '—' })}
        </span>

        <time
          dateTime={log.created_at}
          className="ml-auto text-xs text-muted-foreground tabular-nums"
        >
          {formatRelativeTime(log.created_at, locale)}
        </time>
      </div>

      <p className="text-micro text-muted-foreground">{t('actorLine', { name: actorName })}</p>

      {log.ip ? (
        <p className="text-micro text-muted-foreground">{t('ip', { ip: log.ip })}</p>
      ) : null}

      {payload.length > 0 ? (
        <details className="text-micro text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {t('showDiff')}
          </summary>
          <div className="mt-2 space-y-2">
            {payload.map((entry) => (
              <div key={entry.key} className="space-y-1">
                <span className="block font-medium text-foreground">{t(entry.key)}</span>
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
                  {JSON.stringify(entry.value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </li>
  );
}

export function AuditLog() {
  const t = useTranslations('admin.audit');
  const [action, setAction] = useState<AuditAction | null>(null);
  const [entity, setEntity] = useState<AuditEntity | null>(null);

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
  } = useAuditLog({ action, entity });

  const canLoadMore = hasNextPage && !isFetchingNextPage;
  const sentinelRef = useInView<HTMLDivElement>(() => {
    if (canLoadMore) void fetchNextPage();
  }, canLoadMore);

  const items = data ? data.pages.flatMap((page) => page.items) : [];

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="audit-action-filter" className="text-micro text-muted-foreground">
          {t('actionLabel')}
        </label>
        <select
          id="audit-action-filter"
          value={action ?? 'all'}
          onChange={(event) => {
            const next = event.target.value;
            setAction(isAction(next) ? next : null);
          }}
          className={FILTER_CLASS}
        >
          <option value="all">{t('allActions')}</option>
          {AUDIT_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="audit-entity-filter" className="text-micro text-muted-foreground">
          {t('entityLabel')}
        </label>
        <select
          id="audit-entity-filter"
          value={entity ?? 'all'}
          onChange={(event) => {
            const next = event.target.value;
            setEntity(isEntity(next) ? next : null);
          }}
          className={FILTER_CLASS}
        >
          <option value="all">{t('allEntities')}</option>
          {AUDIT_ENTITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (isError && isAppApiError(error) && error.status === 403) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6 text-center">
        <ShieldOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('adminOnlyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('adminOnlyBody')}</p>
      </div>
    );
  }

  if (isPending) return <AuditSkeleton />;

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
        <p className="sr-only">{error instanceof Error ? error.message : ''}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('count', { count: items.length })}</p>
        {filters}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
          <ScrollText aria-hidden="true" className="size-6 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((log) => (
            <AuditRow key={log.id} log={log} />
          ))}
        </ul>
      )}

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
      ) : null}
    </div>
  );
}
