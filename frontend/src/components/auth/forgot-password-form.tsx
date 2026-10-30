'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail, MailCheck } from 'lucide-react';
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
  type ForgotPasswordValues,
  forgotPasswordSchema,
  toFieldErrors,
} from '@/lib/validation/auth';

const EMAIL_ID = 'forgot-password-email';

/**
 * Request a password-reset link.
 *
 * `POST /api/v1/auth/forgot-password` answers 200 with the same body whether or
 * not the address exists (src/social_api/modules/auth/router.py:139) — it is
 * deliberately not an account-enumeration oracle. The success panel must
 * therefore NOT say "we sent you an email"; it says *if that address exists*,
 * which is both truthful and the only wording the backend supports.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgotPassword');
  const tValidation = useTranslations('auth.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<ForgotPasswordValues>({ email: '' });
  const [errors, setErrors] = useState<FieldErrors<ForgotPasswordValues>>({});

  const request = useMutation({
    mutationFn: (input: ForgotPasswordValues) =>
      apiRequest(() => apiClient.POST('/api/v1/auth/forgot-password', { body: input })),
  });

  function update(value: string) {
    setValues({ email: value });
    setErrors((current) => (current.email ? { ...current, email: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = forgotPasswordSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<ForgotPasswordValues>(parsed.error));
      return;
    }

    setErrors({});
    request.mutate(parsed.data);
  }

  if (request.isSuccess) {
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

  const pending = request.isPending;
  const submitLabel = pending ? t('submitting') : t('submit');

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {request.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(request.error))}
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
            onChange={(event) => update(event.target.value)}
            aria-invalid={Boolean(errors.email) || undefined}
            aria-describedby={errors.email ? fieldMessageId(EMAIL_ID) : undefined}
            disabled={pending}
          />
        </div>
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {submitLabel}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('remembered')}{' '}
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
