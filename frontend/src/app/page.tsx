import { ArrowRight, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/shared/theme-toggle';
import { ROUTES } from '@/lib/constants';

const FEATURES = [
  { key: 'feed', Icon: Sparkles },
  { key: 'chat', Icon: MessageCircle },
  { key: 'people', Icon: Users },
  { key: 'privacy', Icon: ShieldCheck },
] as const;

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const c = await getTranslations('common');

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <Link href={ROUTES.landing} className="flex items-center gap-2 font-semibold">
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
            >
              S
            </span>
            <span className="text-foreground">{t('brand')}</span>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href={ROUTES.login}
              className="hidden h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none sm:inline-flex"
            >
              {t('nav.signIn')}
            </Link>
            <Link
              href={ROUTES.register}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              {t('nav.signUp')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section className="border-b border-border bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-28">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('hero.eyebrow')}
              </span>

              <h1 className="max-w-2xl text-4xl leading-tight font-semibold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
                {t('hero.title')}
              </h1>

              <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
                {t('hero.body')}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={ROUTES.register}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                >
                  {t('hero.primaryCta')}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href={ROUTES.designSystem}
                  className="inline-flex h-11 items-center rounded-md border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                >
                  {t('hero.secondaryCta')}
                </Link>
              </div>

              <p className="text-xs text-muted-foreground">{t('hero.note')}</p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                >
                  A
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-card-foreground">
                    {t('mock.author')}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t('mock.meta')}</p>
                </div>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('mock.badge')}
                </span>
              </div>

              <p className="pt-4 text-sm leading-relaxed text-card-foreground">{t('mock.body')}</p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="h-20 rounded-lg bg-chart-1/15" />
                <div className="h-20 rounded-lg bg-chart-2/15" />
                <div className="h-20 rounded-lg bg-chart-3/15" />
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('mock.likes')}</span>
                <span>{t('mock.comments')}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, Icon }) => (
              <article
                key={key}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h2 className="mt-4 text-base font-semibold text-card-foreground">
                  {t(`features.${key}.title`)}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`features.${key}.body`)}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>{t('footer.note')}</p>
          <p>{c('milestoneBadge')}</p>
        </div>
      </footer>
    </div>
  );
}
