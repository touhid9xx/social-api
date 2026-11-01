'use client';

import { ShieldOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/hooks/use-dashboard';
import { isAppApiError } from '@/lib/api';
import {
  DASHBOARD_WINDOWS,
  DEFAULT_DASHBOARD_WINDOW,
  isDashboardWindow,
  type DashboardDailyPoint,
  type DashboardOverview,
  type DashboardWindow,
} from '@/lib/api/dashboard';
import {
  formatBytes,
  formatCount,
  formatDay,
  formatMilliseconds,
  formatPercent,
  formatRelativeTime,
} from '@/lib/format';

/**
 * The admin overview — `GET /admin/dashboard`.
 *
 * Four contract facts shape this screen:
 *
 *  1. **One request, five sections.** The endpoint aggregates users, content,
 *     storage, traffic and workers in a single response, so there is no paging,
 *     no cursor and no per-panel loading state — only one query keyed by window.
 *  2. **`available` is not the same as zero.** `traffic` reports `available:
 *     false` when visit analytics is switched off or has recorded nothing, and
 *     `workers` does the same when Redis is unreachable. Rendering those as a
 *     wall of zeros would be a lie, so both panels have an explicit "no data"
 *     state instead.
 *  3. **`403` is an ordinary answer.** The route is `require_roles(ADMIN)` and
 *     the frontend has no role to pre-check (`/users/me` returns no role), and
 *     `query-provider.tsx` skips 4xx retries — so a non-admin settles into the
 *     "admins only" state after one request.
 *  4. **Days are sparse.** Aggregates omit days with no rows rather than
 *     zero-filling a 90-point series, so the charts render what came back and
 *     never invent a trough that did not happen.
 *
 * Nothing here translates a `path_class` back into a sentence beyond a fixed
 * label map: the buckets are backend vocabulary, and a bucket the frontend has
 * never heard of is printed verbatim rather than dropped.
 */

/** No Select primitive exists in `components/ui`; this matches the native ones. */
const CONTROL_CLASS =
  'h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/** Mirrors `PathClass` in `src/social_api/modules/analytics/models.py`. */
const PATH_CLASSES = [
  'auth',
  'feed',
  'posts',
  'comments',
  'media',
  'chat',
  'search',
  'profile',
  'notifications',
  'admin',
  'other',
] as const;

type PathClassKey = (typeof PATH_CLASSES)[number];

function isPathClass(value: string): value is PathClassKey {
  return (PATH_CLASSES as readonly string[]).includes(value);
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}

/** One counter. `hint` carries the secondary number a bare value would hide. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <dt className="text-micro text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold text-foreground tabular-nums">{value}</dd>
      {hint ? <p className="text-micro text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function StatGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</dl>;
}

/**
 * A sparse daily series as horizontal bars.
 *
 * The bars are `aria-hidden` decoration: the value is already in the adjacent
 * text, and an empty bar element with no accessible name would only add noise.
 */
function DailyBars({
  points,
  locale,
  emptyLabel,
}: {
  points: DashboardDailyPoint[];
  locale: string;
  emptyLabel: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const peak = points.reduce((max, point) => Math.max(max, point.value), 0) || 1;

  return (
    <ul className="space-y-1.5">
      {points.map((point) => (
        <li key={point.day} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-micro text-muted-foreground">
            {formatDay(point.day, locale)}
          </span>
          <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, (point.value / peak) * 100)}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-micro text-foreground tabular-nums">
            {formatCount(point.value, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-pretty text-muted-foreground">{body}</p>
    </div>
  );
}

function DashboardSkeleton() {
  const t = useTranslations('admin.dashboard');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3 rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((cell) => (
              <Skeleton key={cell} className="h-16 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({ data }: { data: DashboardOverview }) {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();

  const { users, content, storage, traffic, workers } = data;
  const windows = { days: data.window_days };

  return (
    <div className="space-y-4">
      <Panel title={t('users.title')} description={t('users.description', windows)}>
        <StatGrid>
          <Stat label={t('users.total')} value={formatCount(users.total, locale)} />
          <Stat label={t('users.active')} value={formatCount(users.active, locale)} />
          <Stat label={t('users.verified')} value={formatCount(users.verified, locale)} />
          <Stat label={t('users.staff')} value={formatCount(users.staff, locale)} />
          <Stat
            label={t('users.newInWindow')}
            value={formatCount(users.new_in_window, locale)}
            hint={t('users.previousWindow', {
              count: formatCount(users.new_previous_window, locale),
            })}
          />
          <Stat label={t('users.active24h')} value={formatCount(users.active_last_24h, locale)} />
          <Stat label={t('users.active7d')} value={formatCount(users.active_last_7d, locale)} />
          <Stat label={t('users.active30d')} value={formatCount(users.active_last_30d, locale)} />
          <Stat label={t('users.deleted')} value={formatCount(users.deleted, locale)} />
        </StatGrid>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{t('users.signupsTitle')}</h3>
          <DailyBars
            points={users.signups_by_day}
            locale={locale}
            emptyLabel={t('users.signupsEmpty')}
          />
        </div>
      </Panel>

      <Panel title={t('content.title')} description={t('content.description', windows)}>
        <StatGrid>
          <Stat label={t('content.posts')} value={formatCount(content.posts, locale)} />
          <Stat label={t('content.comments')} value={formatCount(content.comments, locale)} />
          <Stat label={t('content.likes')} value={formatCount(content.likes, locale)} />
          <Stat label={t('content.follows')} value={formatCount(content.follows, locale)} />
          <Stat label={t('content.rooms')} value={formatCount(content.chat_rooms, locale)} />
          <Stat label={t('content.messages')} value={formatCount(content.messages, locale)} />
          <Stat
            label={t('content.postsInWindow')}
            value={formatCount(content.posts_in_window, locale)}
          />
          <Stat
            label={t('content.commentsInWindow')}
            value={formatCount(content.comments_in_window, locale)}
          />
          <Stat
            label={t('content.messagesInWindow')}
            value={formatCount(content.messages_in_window, locale)}
          />
        </StatGrid>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{t('content.activityTitle')}</h3>
          <p className="text-micro text-muted-foreground">{t('content.activityHint')}</p>
          <DailyBars
            points={content.activity_by_day}
            locale={locale}
            emptyLabel={t('content.activityEmpty')}
          />
        </div>
      </Panel>

      <Panel title={t('storage.title')} description={t('storage.description')}>
        <StatGrid>
          <Stat label={t('storage.total')} value={formatBytes(storage.total_bytes, locale)} />
          <Stat label={t('storage.mediaCount')} value={formatCount(storage.media_count, locale)} />
          <Stat label={t('storage.images')} value={formatBytes(storage.image_bytes, locale)} />
          <Stat label={t('storage.videos')} value={formatBytes(storage.video_bytes, locale)} />
          <Stat
            label={t('storage.usersWithMedia')}
            value={formatCount(storage.users_with_media, locale)}
          />
          <Stat
            label={t('storage.averagePerUser')}
            value={formatBytes(storage.average_bytes_per_user, locale)}
          />
          <Stat
            label={t('storage.orphans')}
            value={formatCount(storage.orphan_count, locale)}
            hint={t('storage.orphansHint', { bytes: formatBytes(storage.orphan_bytes, locale) })}
          />
        </StatGrid>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{t('storage.topConsumersTitle')}</h3>
          {storage.top_consumers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('storage.topConsumersEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {storage.top_consumers.map((consumer) => (
                <li
                  key={consumer.user_id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-border/70 bg-background/40 px-3 py-2"
                >
                  <span className="text-sm text-foreground">
                    {consumer.display_name?.trim() ||
                      t('storage.userFallback', { id: consumer.user_id })}
                  </span>
                  <span className="text-micro text-muted-foreground tabular-nums">
                    {t('storage.consumerLine', {
                      count: formatCount(consumer.media_count, locale),
                    })}
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {formatBytes(consumer.total_bytes, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel title={t('traffic.title')} description={t('traffic.description', windows)}>
        {traffic.available ? (
          <div className="space-y-4">
            <StatGrid>
              <Stat label={t('traffic.requests')} value={formatCount(traffic.requests, locale)} />
              <Stat
                label={t('traffic.authenticated')}
                value={formatCount(traffic.authenticated_requests, locale)}
              />
              <Stat
                label={t('traffic.uniqueVisitors')}
                value={formatCount(traffic.unique_visitors, locale)}
              />
              <Stat
                label={t('traffic.errorRate')}
                value={formatPercent(traffic.error_rate, locale)}
                hint={t('traffic.errorsHint', {
                  count: formatCount(traffic.error_requests, locale),
                })}
              />
              <Stat
                label={t('traffic.avgLatency')}
                value={formatMilliseconds(traffic.avg_latency_ms, locale)}
              />
              <Stat
                label={t('traffic.p95Latency')}
                value={formatMilliseconds(traffic.p95_latency_ms, locale)}
              />
            </StatGrid>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{t('traffic.requestsTitle')}</h3>
              <DailyBars
                points={traffic.requests_by_day}
                locale={locale}
                emptyLabel={t('traffic.requestsEmpty')}
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{t('traffic.byClassTitle')}</h3>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-micro text-muted-foreground">
                    <th scope="col" className="pb-1 font-medium">
                      {t('traffic.classColumn')}
                    </th>
                    <th scope="col" className="pb-1 text-right font-medium">
                      {t('traffic.requestsColumn')}
                    </th>
                    <th scope="col" className="pb-1 text-right font-medium">
                      {t('traffic.errorsColumn')}
                    </th>
                    <th scope="col" className="pb-1 text-right font-medium">
                      {t('traffic.latencyColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.by_class.map((row) => (
                    <tr key={row.path_class} className="border-t border-border/70">
                      <td className="py-1.5 text-foreground">
                        {isPathClass(row.path_class)
                          ? t(`traffic.class.${row.path_class}`)
                          : row.path_class}
                      </td>
                      <td className="py-1.5 text-right text-foreground tabular-nums">
                        {formatCount(row.requests, locale)}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                        {formatCount(row.error_requests, locale)}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                        {formatMilliseconds(row.avg_latency_ms, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">{t('traffic.regionsTitle')}</h3>
              {traffic.regions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('traffic.regionsEmpty')}</p>
              ) : (
                <ul className="space-y-1">
                  {traffic.regions.map((row, index) => (
                    <li
                      key={`${row.country ?? 'unknown'}:${row.city ?? ''}:${row.timezone ?? ''}:${String(index)}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-border/70 bg-background/40 px-3 py-2"
                    >
                      <span className="text-sm text-foreground">
                        {[row.country ?? t('traffic.regionUnknown'), row.city]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="text-micro text-muted-foreground">
                        {row.timezone ?? '—'}
                      </span>
                      <span className="text-sm text-foreground tabular-nums">
                        {formatCount(row.requests, locale)}
                      </span>
                      <span className="text-micro text-muted-foreground tabular-nums">
                        {formatPercent(row.share, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <Unavailable title={t('traffic.unavailableTitle')} body={t('traffic.unavailableBody')} />
        )}
      </Panel>

      <Panel title={t('workers.title')} description={t('workers.description')}>
        {workers.available ? (
          <StatGrid>
            <Stat
              label={t('workers.queueDepth')}
              value={formatCount(workers.queue_depth, locale)}
            />
          </StatGrid>
        ) : (
          <Unavailable title={t('workers.unavailableTitle')} body={t('workers.unavailableBody')} />
        )}
      </Panel>
    </div>
  );
}

export function Dashboard() {
  const t = useTranslations('admin.dashboard');
  const locale = useLocale();
  const [windowDays, setWindowDays] = useState<DashboardWindow>(DEFAULT_DASHBOARD_WINDOW);
  const { data, isPending, isError, error, refetch } = useDashboard(windowDays);

  if (isError && isAppApiError(error) && error.status === 403) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6 text-center">
        <ShieldOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('adminOnlyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('adminOnlyBody')}</p>
      </div>
    );
  }

  // The window switcher stays mounted across loading and error states: retrying
  // the 90-day aggregate after a 7-day failure has to be possible without a
  // reload, and the control is the only place that choice lives.
  const switcher = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="dashboard-window" className="text-micro text-muted-foreground">
          {t('windowLabel')}
        </label>
        <select
          id="dashboard-window"
          value={windowDays}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (isDashboardWindow(next)) setWindowDays(next);
          }}
          className={CONTROL_CLASS}
        >
          {DASHBOARD_WINDOWS.map((days) => (
            <option key={days} value={days}>
              {t('windowOption', { days })}
            </option>
          ))}
        </select>
      </div>

      {data ? (
        <p className="text-xs text-muted-foreground">
          {t('generatedAt', { time: formatRelativeTime(data.generated_at, locale) })}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {switcher}

      {isPending ? <DashboardSkeleton /> : null}

      {isError && !isPending ? (
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
      ) : null}

      {data ? <Overview data={data} /> : null}
    </div>
  );
}
