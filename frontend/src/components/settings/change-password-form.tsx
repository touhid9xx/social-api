'use client';

import { Check, Eye, EyeOff, Loader2, Lock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChangePassword } from '@/hooks/use-change-password';
import { useSignOut } from '@/hooks/use-sign-out';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import {
  type ChangePasswordValues,
  changePasswordSchema,
  type FieldErrors,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordChecks,
  toFieldErrors,
} from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

const CURRENT_ID = 'change-password-current';
const NEW_ID = 'change-password-new';
const RULES_ID = 'change-password-rules';

const EMPTY: ChangePasswordValues = { currentPassword: '', newPassword: '' };

/**
 * Settings → Security: rotate the caller's own password.
 *
 * `POST /api/v1/auth/change-password` takes `{ current_password, new_password }`.
 * The bearer token proves *who* is calling; `current_password` proves the caller
 * owns the account, so a wrong one answers 401 `INVALID_CREDENTIALS` — mapped by
 * `errorMessageKey` to `errors.invalidCredentials`, never rendered as a raw code.
 *
 * The new password reuses the shared policy checklist from the reset form: the
 * backend runs the same `validate_password_policy` on it, so the two screens must
 * not be able to disagree about what it accepts.
 *
 * Success ends the session. The backend blacklists the access token this request
 * arrived on, so every subsequent call would earn a 401; signing out is the only
 * honest outcome, and it is the path the user expects ("enter your new password
 * next time you sign in"). `useSignOut` clears the cache first, so a shared
 * device cannot show the next account this one's data.
 *
 * (সফল হলে সেশন শেষ হয় — সার্ভার এই অনুরোধের অ্যাক্সেস টোকেন ব্ল্যাকলিস্ট করে, তাই
 *  সাইন আউট করাই একমাত্র সৎ পরিণতি।)
 */
export function ChangePasswordForm() {
  const t = useTranslations('settings.security');
  const tValidation = useTranslations('auth.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<ChangePasswordValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<ChangePasswordValues>>({});
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const change = useChangePassword();
  const { signOut } = useSignOut();

  function update<K extends keyof ChangePasswordValues>(field: K, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<ChangePasswordValues>(parsed.error));
      return;
    }

    setErrors({});
    change.mutate(parsed.data, {
      onSuccess: async () => {
        toast.success(t('success'));
        await signOut();
      },
    });
  }

  const pending = change.isPending;
  const checks = passwordChecks(values.newPassword);

  // `INVALID_CREDENTIALS` is the *login* wording ("Incorrect email or password")
  // and the email half of it is nonsense here, so this one code is re-worded for
  // the form. Every other failure resolves through the shared catalog.
  const failureMessage =
    isAppApiError(change.error) && change.error.code === 'INVALID_CREDENTIALS'
      ? t('wrongCurrentPassword')
      : tRoot(errorMessageKey(change.error));

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-pretty text-muted-foreground">{t('intro')}</p>

      {change.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {failureMessage}
        </p>
      ) : null}

      <Field
        label={t('currentPassword')}
        htmlFor={CURRENT_ID}
        error={
          errors.currentPassword
            ? tValidation(errors.currentPassword, { min: PASSWORD_MIN_LENGTH })
            : undefined
        }
      >
        <div className="relative">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={CURRENT_ID}
            name="currentPassword"
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            required
            className="px-9"
            placeholder={t('currentPasswordPlaceholder')}
            value={values.currentPassword}
            onChange={(event) => update('currentPassword', event.target.value)}
            aria-invalid={Boolean(errors.currentPassword) || undefined}
            aria-describedby={errors.currentPassword ? fieldMessageId(CURRENT_ID) : undefined}
            disabled={pending}
          />
          <button
            type="button"
            onClick={() => setShowCurrent((shown) => !shown)}
            aria-label={showCurrent ? t('hidePassword') : t('showPassword')}
            aria-pressed={showCurrent}
            className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showCurrent ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
      </Field>

      <Field
        label={t('newPassword')}
        htmlFor={NEW_ID}
        error={
          errors.newPassword
            ? tValidation(errors.newPassword, { min: PASSWORD_MIN_LENGTH })
            : undefined
        }
      >
        <div className="relative">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={NEW_ID}
            name="newPassword"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            className="px-9"
            placeholder={t('newPasswordPlaceholder', { min: PASSWORD_MIN_LENGTH })}
            value={values.newPassword}
            onChange={(event) => update('newPassword', event.target.value)}
            aria-invalid={Boolean(errors.newPassword) || undefined}
            aria-describedby={errors.newPassword ? fieldMessageId(NEW_ID) : RULES_ID}
            disabled={pending}
          />
          <button
            type="button"
            onClick={() => setShowNew((shown) => !shown)}
            aria-label={showNew ? t('hidePassword') : t('showPassword')}
            aria-pressed={showNew}
            className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showNew ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
      </Field>

      <ul id={RULES_ID} className="grid gap-1.5">
        {PASSWORD_RULES.map((rule) => {
          const met = checks[rule];
          const Icon = met ? Check : X;
          return (
            <li
              key={rule}
              className={cn(
                'flex items-center gap-2 text-micro',
                met ? 'text-success' : 'text-muted-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{tValidation(`rules.${rule}`, { min: PASSWORD_MIN_LENGTH })}</span>
              <span className="sr-only">
                {met ? tValidation('ruleMet') : tValidation('ruleUnmet')}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-pretty text-muted-foreground">{t('signOutNotice')}</p>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
