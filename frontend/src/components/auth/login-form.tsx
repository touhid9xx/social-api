'use client';

import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient, apiRequest, errorMessageKey, startSession } from '@/lib/api';
import { postSignInPath } from '@/lib/auth-routes';
import { ROUTES } from '@/lib/constants';
import {
  type FieldErrors,
  type LoginValues,
  loginSchema,
  toFieldErrors,
} from '@/lib/validation/auth';

const EMAIL_ID = 'login-email';
const PASSWORD_ID = 'login-password';

/**
 * Read `?next=` from the address bar.
 *
 * Deliberately not `useSearchParams()`: that would force this page under a
 * `Suspense` boundary for static rendering, and the value is only needed at
 * submission time anyway. The result is passed through `postSignInPath`, which
 * rejects anything that is not a safe internal path — `router.replace()` would
 * otherwise follow `/login?next=https://evil.example` straight off the origin.
 */
function readNextParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('next');
}

/**
 * Sign-in form.
 *
 * The backend answers `POST /api/v1/auth/login` with the NESTED envelope
 * `{ user, tokens }` (contracts/api_reference.md:121), so the tokens come from
 * `data.tokens`. `errorMessageKey` turns any failure — 401 INVALID_CREDENTIALS,
 * 429 RATE_LIMITED, offline — into one localized sentence, never a raw code.
 *
 * (বাংলা: ফর্ম ভ্যালিডেশন zod দিয়ে, নেটওয়ার্ক কল `apiClient` দিয়ে — নতুন কোনো
 *  HTTP লেয়ার বানানো হয়নি।)
 */
export function LoginForm() {
  const t = useTranslations('auth.login');
  const tValidation = useTranslations('auth.validation');
  const tRoot = useTranslations();
  const router = useRouter();

  const [values, setValues] = useState<LoginValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors<LoginValues>>({});
  const [showPassword, setShowPassword] = useState(false);

  const login = useMutation({
    mutationFn: (input: LoginValues) =>
      apiRequest(() => apiClient.POST('/api/v1/auth/login', { body: input })),
    onSuccess: async (data) => {
      // Only the short-lived access token stays in memory: `startSession`
      // hands the refresh token to the httpOnly cookie route, so the session
      // survives a reload without a JS-readable credential.
      await startSession(data.tokens);
      // Honour a `?next=` set by the session guard (a reload on a protected page
      // whose refresh cookie had expired), validated so this screen can never
      // become an open redirect. Falls back to home, and refuses auth pages so
      // the user cannot be bounced back into a form they just completed.
      //
      // `replace`, not `push`: the browser back button must not return to a form
      // that has already been submitted.
      router.replace(postSignInPath(readNextParam()));
      router.refresh();
    },
  });

  function update(field: keyof LoginValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Clear a stale message as soon as the user edits that field.
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<LoginValues>(parsed.error));
      return;
    }

    setErrors({});
    login.mutate(parsed.data);
  }

  const pending = login.isPending;
  const submitLabel = pending ? t('submitting') : t('submit');

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {login.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(login.error))}
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
        error={errors.password ? tValidation(errors.password) : undefined}
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
            autoComplete="current-password"
            required
            className="px-9"
            placeholder={t('passwordPlaceholder')}
            value={values.password}
            onChange={(event) => update('password', event.target.value)}
            aria-invalid={Boolean(errors.password) || undefined}
            aria-describedby={errors.password ? fieldMessageId(PASSWORD_ID) : undefined}
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

      <div className="flex justify-end">
        <Link
          href={ROUTES.forgotPassword}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {t('forgot')}
        </Link>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {submitLabel}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link
          href={ROUTES.register}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {t('createAccount')}
        </Link>
      </p>
    </form>
  );
}
