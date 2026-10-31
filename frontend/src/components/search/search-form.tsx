'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ROUTES } from '@/lib/constants';

const QUERY_INPUT_ID = 'search-query';

/**
 * The search box.
 *
 * Submission is a `router.push` to `/search?q=…`, not local state: the term is
 * part of the URL so a result page is linkable, survives reload, and re-renders
 * the server component with the new `searchParams`. That is also why the box
 * holds nothing but the draft — `initialTerm` seeds it from the URL, and the
 * page remounts it per term (see `page.tsx`), so the two never disagree.
 *
 * The trimmed value is used for the URL; whitespace-only submissions are
 * ignored rather than pushed, because an empty `q` would only bounce off the
 * backend's length floor.
 */
export function SearchForm({ initialTerm }: { initialTerm: string }) {
  const t = useTranslations('search');
  const router = useRouter();
  const [draft, setDraft] = useState(initialTerm);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;

    router.push(`${ROUTES.search}?q=${encodeURIComponent(next)}`);
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <label htmlFor={QUERY_INPUT_ID} className="text-sm font-medium text-foreground">
          {t('label')}
        </label>
        <Input
          id={QUERY_INPUT_ID}
          name="q"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('placeholder')}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      <Button type="submit" disabled={draft.trim().length === 0}>
        {t('submit')}
      </Button>
    </form>
  );
}
