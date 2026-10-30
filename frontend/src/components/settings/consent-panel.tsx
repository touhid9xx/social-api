'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsents } from '@/hooks/use-consents';
import { useGrantConsent, useRevokeConsent } from '@/hooks/use-consent-actions';
import { errorMessageKey } from '@/lib/api';
import { CONSENT_CHANNELS, type ConsentChannel } from '@/lib/api/users';
import { cn } from '@/lib/utils';

/**
 * Settings → Privacy: the four consent channels as switches.
 *
 * `GET /users/me/consent` only returns channels the user has ever acted on, so
 * the switches are built from `CONSENT_CHANNELS` (the enum in the contract) and a
 * missing row is read as "off". Building the list from the response would hide
 * every channel the user has never touched — which is most of them, on day one.
 *
 * The grant/revoke mutations are not optimistic (see `use-consent-actions.ts`),
 * so the switch reflects `aria-checked` from the query cache and simply sits
 * disabled until the server answers.
 */
export function ConsentPanel() {
  const t = useTranslations('settings.consent');
  const tRoot = useTranslations();

  const consents = useConsents();
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();

  if (consents.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">{t('loading')}</span>
        {CONSENT_CHANNELS.map((channel) => (
          <div key={channel} className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (consents.isError || !consents.data) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium text-foreground">{t('errorTitle')}</p>
        <Button variant="outline" size="sm" onClick={() => void consents.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const rows = consents.data;
  const failure = grant.isError ? grant : revoke.isError ? revoke : null;
  const busyChannel = grant.isPending
    ? grant.variables
    : revoke.isPending
      ? revoke.variables
      : undefined;

  function isGranted(channel: ConsentChannel): boolean {
    return rows.find((row) => row.channel === channel)?.granted ?? false;
  }

  function toggle(channel: ConsentChannel, next: boolean) {
    if (next) grant.mutate(channel);
    else revoke.mutate(channel);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(failure.error))}
        </div>
      ) : null}

      <ul className="divide-y divide-border">
        {CONSENT_CHANNELS.map((channel) => {
          const granted = isGranted(channel);
          const busy = busyChannel === channel;

          return (
            <li key={channel} className="flex items-start justify-between gap-4 py-4 first:pt-0">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {t(`channels.${channel}.title`)}
                </p>
                <p className="text-micro text-muted-foreground">
                  {t(`channels.${channel}.description`)}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={granted}
                aria-label={t(`channels.${channel}.title`)}
                disabled={busy}
                onClick={() => toggle(channel, !granted)}
                className={cn(
                  'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
                  granted ? 'bg-primary' : 'bg-input',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'block size-5 rounded-full bg-background shadow-xs transition-transform',
                    granted ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-micro text-muted-foreground">{t('footer')}</p>
    </div>
  );
}
