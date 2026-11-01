'use client';

import { Flag, Loader2, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useFlags, useSetFlagOverride } from '@/hooks/use-flags';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import type { FlagOverrideResponse } from '@/lib/api/flags';

/**
 * Admin feature flags — `src/social_api/api/v1/flags.py`.
 *
 * Four contract facts shape this screen:
 *
 *  1. **403 is an answer, not a fault.** Both endpoints are
 *     `require_roles(ADMIN)`, and `ProfileSelf` exposes no `role`, so the caller
 *     cannot pre-check. `query-provider.tsx` skips 4xx retries, so a non-admin
 *     lands in the "admins only" state after exactly one request.
 *  2. **The list shows env vs. builtin, nothing else.** `FlagView` has exactly
 *     `name`, `env_value`, `builtin_value` — no override count, because counting
 *     overrides SCANs Redis per flag. So the table can flag *drift* between the
 *     environment and the code default, and cannot show who is overridden.
 *  3. **Resolution order is override → env → builtin.** The two badges are the
 *     two values an admin can actually see; the override sits on top of them and
 *     is written blind.
 *  4. **A write changes nothing visible here.** The endpoint echoes the applied
 *     value (`FlagOverrideResponse`), and `action` is the only way to tell
 *     "cleared" from "set to off" — both come back as `enabled: false`. The
 *     screen reports that echo rather than pretending a list refresh happened.
 */

/** No Select primitive exists in `components/ui`; this matches the native ones. */
const CONTROL_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/** What the select offers. `clear` is the contract's `enabled: null`. */
const OVERRIDE_CHOICES = ['on', 'off', 'clear'] as const;

type OverrideChoice = (typeof OVERRIDE_CHOICES)[number];

function overrideValue(choice: OverrideChoice): boolean | null {
  if (choice === 'clear') return null;
  return choice === 'on';
}

/** Digits only, so `-1`, `1.5`, `1e3` and `` are all rejected before the wire. */
function parseUserId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function successKey(result: FlagOverrideResponse): 'savedOn' | 'savedOff' | 'savedCleared' {
  if (result.action === 'cleared' || result.enabled === null) return 'savedCleared';
  return result.enabled ? 'savedOn' : 'savedOff';
}

function FlagSkeleton() {
  const t = useTranslations('admin.flags');

  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('loading')}</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-2 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
      ))}
    </div>
  );
}

function OverrideForm({ flags }: { flags: string[] }) {
  const t = useTranslations('admin.flags');
  const tRoot = useTranslations();
  const override = useSetFlagOverride();

  const [flag, setFlag] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [choice, setChoice] = useState<OverrideChoice>('on');
  const [invalid, setInvalid] = useState(false);

  // Derived, never mirrored into state: the select falls back to the first flag
  // until the admin picks one, so no effect has to keep the two in sync.
  const selected = flags.includes(flag) ? flag : (flags[0] ?? '');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = parseUserId(userId);
    if (parsed === null || selected === '') {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    // `user_id`, not `userId`: `FlagOverrideVariables` is `{ flagName }` intersected
    // with the generated `FlagOverride` contract type, whose keys are snake_case.
    override.mutate({ flagName: selected, user_id: parsed, enabled: overrideValue(choice) });
  }

  const result = override.data;

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-busy={override.isPending}
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{t('overrideTitle')}</h2>
        <p className="text-micro text-pretty text-muted-foreground">{t('overrideSubtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('flagLabel')} htmlFor="flag-override-name">
          <select
            id="flag-override-name"
            value={selected}
            onChange={(event) => setFlag(event.target.value)}
            disabled={override.isPending || flags.length === 0}
            className={CONTROL_CLASS}
          >
            {flags.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('userLabel')}
          htmlFor="flag-override-user"
          error={invalid ? t('userIdInvalid') : undefined}
          invalid={invalid}
        >
          <Input
            id="flag-override-user"
            name="user_id"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={userId}
            placeholder={t('userPlaceholder')}
            aria-invalid={invalid}
            aria-describedby={invalid ? fieldMessageId('flag-override-user') : undefined}
            onChange={(event) => {
              setUserId(event.target.value);
              setInvalid(false);
            }}
            disabled={override.isPending}
          />
        </Field>

        <Field label={t('valueLabel')} htmlFor="flag-override-value">
          <select
            id="flag-override-value"
            value={choice}
            onChange={(event) => setChoice(event.target.value as OverrideChoice)}
            disabled={override.isPending}
            className={CONTROL_CLASS}
          >
            {OVERRIDE_CHOICES.map((value) => (
              <option key={value} value={value}>
                {t(value === 'on' ? 'enable' : value === 'off' ? 'disable' : 'clear')}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={override.isPending || flags.length === 0}>
          {override.isPending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t('submit')}
        </Button>

        {result ? (
          <p role="status" className="text-sm text-foreground">
            {t(successKey(result), { flag: result.flag, id: result.user_id })}
          </p>
        ) : null}

        {override.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {isAppApiError(override.error)
              ? tRoot(errorMessageKey(override.error))
              : t('saveFailed')}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function FlagList() {
  const t = useTranslations('admin.flags');
  const { data, isPending, isError, error, refetch } = useFlags();

  // Staff-only, and the caller's role is unknowable client-side — this is the
  // expected outcome for a signed-in non-admin, not a failure to apologise for.
  if (isError && isAppApiError(error) && error.status === 403) {
    return (
      <div className="space-y-2 rounded-xl border border-border bg-card p-6 text-center">
        <ShieldOff aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('adminOnlyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('adminOnlyBody')}</p>
      </div>
    );
  }

  if (isPending) return <FlagSkeleton />;

  if (isError) {
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

  const flags = data.flags;

  if (flags.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
        <Flag aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="text-base font-semibold text-foreground">{t('emptyTitle')}</h2>
        <p className="text-sm text-pretty text-muted-foreground">{t('emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t('count', { count: flags.length })}</p>

      <ul className="space-y-2">
        {flags.map((flag) => (
          <li key={flag.name} className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm font-medium text-foreground">{flag.name}</code>
              <Badge variant={flag.env_value ? 'secondary' : 'outline'}>
                {t('envLabel')}: {t(flag.env_value ? 'on' : 'off')}
              </Badge>
              <Badge variant={flag.builtin_value ? 'secondary' : 'outline'}>
                {t('builtinLabel')}: {t(flag.builtin_value ? 'on' : 'off')}
              </Badge>
            </div>
            {flag.env_value !== flag.builtin_value ? (
              <p className="mt-1 text-micro text-muted-foreground">{t('drift')}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <OverrideForm flags={flags.map((flag) => flag.name)} />
    </div>
  );
}
