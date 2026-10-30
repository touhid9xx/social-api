'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, Eye, EyeOff, Loader2, Lock, Mail, MailCheck, X } from 'lucide-react';
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
  type RegisterValues,
  registerSchema,
  toFieldErrors,
} from '@/lib/validation/auth';
import { cn } from '@/lib/utils';

const EMAIL_ID = 'register-email';
const PASSWORD_ID = 'register-password';

/**
 * Registration form.
 *
 * `POST /api/v1/auth/register` answers 201 with `{ user, message }` — NO tokens:
 * the backend mails a verification link and only `/auth/login` mints a session.
 * So a successful submit swaps the form for a "check your inbox" panel instead
 * of routing the user somewhere they cannot yet go.
 *
 * The policy checklist below the field mirrors `validate_password_policy`
 * (src/social_api/core/password.py) so the user sees the rules before the
 * server rejects the password.
 */
export function RegisterForm() {
  const t = useTranslations('auth.register');
  const tValidation = useTranslations('auth.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<RegisterValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<RegisterValues>>({});
  const [showPassword, setShowPassword] = useState(false);

  const register = useMutation({
    mutationFn: (input: RegisterValues) =>
      apiRequest(() => apiClient.POST('/api/v1/auth/register', { body: input })),
  });

  function update(field: keyof RegisterValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<RegisterValues>(parsed.error));
      return;
    }

    setErrors({});
    register.mutate(parsed.data);
  }

  if (register.isSuccess) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
          <MailCheck aria-hidden="true" className="size-6" />
        </span>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{t('sentTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {t('sentBody', { email: values.email })}
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href={ROUTES.login}>{t('goToSignIn')}</Link>
        </Button>
      </div>
    );
  }

  const pending = register.isPending;
  const checks = passwordChecks(values.password);
  const submitLabel = pending ? t('submitting') : t('submit');

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {register.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(register.error))}
        </p>
      ) : null}

      <Field
        label={t('email')}
        htmlFor={EMAIL_ID}
        error={errors.email ? tValidation(errors.email) : undefined}
      >
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={EMAIL_ID}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            required
            className="pl-9"
            placeholder={t('emailPlaceholder')}
            value={values.email}
            onChange={(event) => update('email', event.target.value)}
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={errors.email ? fieldMessageId(EMAIL_ID) : undefined}
            disabled={pending}
          />
        </div>
      </Field>

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
            required
            className="px-9"
            placeholder={t('passwordPlaceholder', { min: PASSWORD_MIN_LENGTH })}
            value={values.password}
            onChange={(event) => update('password', event.target.value)}
            aria-invalid={Boolean(errors.password) || undefined}
            aria-describedby={errors.password ? fieldMessageId(PASSWORD_ID) : 'register-rules'}
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

      <ul id="register-rules" className="grid gap-1.5">
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
        {t('haveAccount')}{' '}
        <Link
          href={ROUTES.login}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}
