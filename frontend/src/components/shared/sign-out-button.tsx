'use client';

import { Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useSignOut } from '@/hooks/use-sign-out';

/**
 * Standalone sign-out control.
 *
 * The behaviour lives in `useSignOut` — see that hook for why the local token is
 * cleared before the network call, and why the query cache is emptied first.
 * This component is only the button.
 */
export function SignOutButton() {
  const t = useTranslations('auth.session');
  const { signOut, pending } = useSignOut();

  const label = pending ? t('signingOut') : t('signOut');

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void signOut();
      }}
      disabled={pending}
      aria-label={label}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <LogOut aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
