'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, CheckCircle2, Eye, EyeOff, Loader2, Lock, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient, apiRequest, errorMessageKey } from '@/lib/api';
import { ROUTES } from '@/lib/constants';
import {
  type FieldErrors,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordChecks,
  type ResetPasswordValues,
  resetPasswordSchema,
  toFieldErrors,
} from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

const PASSWORD_ID = 'reset-password-password';
const RULES_ID = 'reset-password-rules';

/**
 * Choose a new password from an emailed reset link.
 *
 * `POST /api/v1/auth/reset-password` takes `{ token, new_password }` and answers
 * `MessageResponse`. The token comes from `?token=…` in the URL and is passed in
 * as a prop by the server page — it is never a form field, so it is deliberately
 * absent from `resetPasswordSchema`.
 *
 * `new_password` carries the same `Field(12..128)` bounds and the same
 * `validate_password_policy` validator as registration, which is why the policy
 * checklist below the field is identical to `RegisterForm`'s.
 *
 * A consumed or expired token answers 401 `INVALID_TOKEN`; that is terminal, so
 * the only useful action left is requesting a fresh link.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth.resetPassword');
  const tValidation = useTranslations('auth.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<ResetPasswordValues>({ password: '' });
  const [errors, setErrors] = useState<FieldErrors<ResetPasswordValues>>({});
  const [showPassword, setShowPassword] = useState(false);

  const reset = useMutation({
    mutationFn: (input: ResetPasswordValues) =>
      apiRequest(() =>
        apiClient.POST('/api/v1/auth/reset-password', {
          body: { token, new_password: input.password },
        }),
      ),
  });

  function update(value: string) {
    setValues({ password: value });
    setErrors((current) => (current.password ? { ...current, password: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = resetPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<ResetPasswordValues>(parsed.error));
      return;
    }

    setErrors({});
    reset.mutate(parsed.data);
  }

  // No token at all: the link was truncated or hand-typed. Posting would only
  // earn a guaranteed 401, so offer a fresh link instead of a doomed form.
  if (token.length === 0) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <XCircle aria-hidden="true" className="size-6" />
        </span>
        <p role="alert" className="text-sm text-pretty text-muted-foreground">
          {t('missingToken')}
        </p>
        <Button asChild className="w-full">
          <Link href={ROUTES.forgotPassword}>{t('requestNewLink')}</Link>
        </Button>
      </div>
    );
  }

  if (reset.isSuccess) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 aria-hidden="true" className="size-6" />
        </span>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{t('successTitle')}</h2>
          <p role="status" className="text-sm text-pretty text-muted-foreground">
            {t('successBody')}
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href={ROUTES.login}>{t('goToSignIn')}</Link>
        </Button>
      </div>
    );
  }

  const pending = reset.isPending;
  const checks = passwordChecks(values.password);
  const submitLabel = pending ? t('submitting') : t('submit');

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {reset.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {/* 401 INVALID_TOKEN resolves to `errors.invalidToken` — never a raw code. */}
          {tRoot(errorMessageKey(reset.error))}
        </p>
      ) : null}

      <Field
        label={t('password')}
        htmlFor={PASSWORD_ID}
        error={
          errors.password ? tValidation(errors.password, { min: PASSWORD_MIN_LENGTH }) : undefined
        }
      >
        <div className="relative">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={PASSWORD_ID}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            required
            className="px-9"
            placeholder={t('passwordPlaceholder', { min: PASSWORD_MIN_LENGTH })}
            value={values.password}
            onChange={(event) => update(event.target.value)}
            aria-invalid={Boolean(errors.password) || undefined}
            aria-describedby={errors.password ? fieldMessageId(PASSWORD_ID) : RULES_ID}
            disabled={pending}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
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

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {submitLabel}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href={ROUTES.forgotPassword}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {t('requestNewLink')}
        </Link>
      </p>
    </form>
  );
}
