'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { apiClient, apiRequest, errorMessageKey, queryKeys } from '@/lib/api';
import { ROUTES } from '@/lib/constants';

/**
 * Email verification panel.
 *
 * `POST /api/v1/auth/verify-email` CONSUMES a one-time token, so this runs once
 * on mount rather than on submit. It is modelled as a `useQuery` (not a mutation
 * in an effect) for two reasons:
 *
 *  1. StrictMode mounts effects twice in development; a mutation fired from an
 *     effect would spend two of the 3/hour the endpoint allows.
 *  2. TanStack de-duplicates concurrent/subsequent requests for the same key, and
 *     `staleTime: Infinity` stops a re-mount from reusing the token a second time.
 *
 * A failure is final — the token is expired, already used, or forged — so there
 * is no retry; the only useful action left is signing in.
 *
 * The token arrives as `?token=…` in the emailed link and is read by the server
 * page, not here: `useSearchParams()` would drag the route under a `Suspense`
 * boundary for no benefit.
 */
export function VerifyEmailPanel({ token }: { token: string }) {
  const t = useTranslations('auth.verifyEmail');
  const tRoot = useTranslations();

  const verification = useQuery({
    queryKey: queryKeys.auth.verifyEmail(token),
    queryFn: () =>
      apiRequest(() => apiClient.POST('/api/v1/auth/verify-email', { body: { token } })),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const signIn = (
    <Button asChild className="w-full">
      <Link href={ROUTES.login}>{t('goToSignIn')}</Link>
    </Button>
  );

  // No token at all: the link was truncated or hand-typed. Nothing to POST, and
  // the query above is disabled — say so instead of spinning forever.
  if (token.length === 0) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <XCircle aria-hidden="true" className="size-6" />
        </span>
        <p role="alert" className="text-sm text-pretty text-muted-foreground">
          {t('missingToken')}
        </p>
        {signIn}
      </div>
    );
  }

  if (verification.isPending) {
    return (
      <div role="status" className="space-y-4 py-4 text-center">
        <Loader2 aria-hidden="true" className="mx-auto size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('verifying')}</p>
      </div>
    );
  }

  if (verification.isError) {
    return (
      <div className="space-y-5 text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <XCircle aria-hidden="true" className="size-6" />
        </span>
        {/* 401 INVALID_TOKEN resolves to `errors.invalidToken` — never a raw code. */}
        <p role="alert" className="text-sm text-pretty text-muted-foreground">
          {tRoot(errorMessageKey(verification.error))}
        </p>
        {signIn}
      </div>
    );
  }

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
      {signIn}
    </div>
  );
}
