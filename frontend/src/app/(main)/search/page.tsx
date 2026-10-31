import { getTranslations } from 'next-intl/server';

import { SearchForm } from '@/components/search/search-form';
import { SearchResults } from '@/components/search/search-results';

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

/**
 * Search — people and posts.
 *
 * The term lives in the URL (`?q=…`), read here on the server: a result page is
 * then linkable, survives reload, and works without client state. Repeated `q`
 * params take the first, matching the `token` handling in the auth pages.
 *
 * `SearchForm` is keyed by the term so its draft state is re-seeded when the
 * server renders a new term — without the key the component instance would keep
 * the old draft while the results below it changed.
 */
export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const term = (raw ?? '').trim();
  const t = await getTranslations('search');

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{t('subtitle')}</p>
      </header>

      <SearchForm key={term} initialTerm={term} />

      <SearchResults term={term} />
    </div>
  );
}
