import { getTranslations } from 'next-intl/server';

import { ThemeToggle } from '@/components/shared/theme-toggle';
import { cn } from '@/lib/utils';

type Swatch = { token: string; className: string };

const SURFACES: Swatch[] = [
  { token: 'background', className: 'bg-background' },
  { token: 'foreground', className: 'bg-foreground' },
  { token: 'card', className: 'bg-card' },
  { token: 'popover', className: 'bg-popover' },
  { token: 'secondary', className: 'bg-secondary' },
  { token: 'muted', className: 'bg-muted' },
  { token: 'accent', className: 'bg-accent' },
  { token: 'border', className: 'bg-border' },
  { token: 'input', className: 'bg-input' },
  { token: 'ring', className: 'bg-ring' },
];

const BRAND: Swatch[] = [
  { token: 'primary', className: 'bg-primary' },
  { token: 'primary-foreground', className: 'bg-primary-foreground' },
  { token: 'destructive', className: 'bg-destructive' },
  { token: 'success', className: 'bg-success' },
  { token: 'sidebar', className: 'bg-sidebar' },
];

const CHARTS: Swatch[] = [
  { token: 'chart-1', className: 'bg-chart-1' },
  { token: 'chart-2', className: 'bg-chart-2' },
  { token: 'chart-3', className: 'bg-chart-3' },
  { token: 'chart-4', className: 'bg-chart-4' },
  { token: 'chart-5', className: 'bg-chart-5' },
];

type Labels = {
  surfaces: string;
  brand: string;
  charts: string;
  typography: string;
  controls: string;
  note: string;
  panel: string;
  scope: string;
  displaySample: string;
  headingSample: string;
  bodySample: string;
  smallSample: string;
  monoSample: string;
  primaryButton: string;
  secondaryButton: string;
  destructiveButton: string;
  disabledButton: string;
  successBadge: string;
  emailPlaceholder: string;
};

function SwatchGrid({ title, swatches }: { title: string; swatches: Swatch[] }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {swatches.map((swatch) => (
          <div key={swatch.token} className="space-y-1.5">
            <div
              className={cn(
                'h-14 w-full rounded-lg border border-border shadow-xs',
                swatch.className,
              )}
            />
            <p className="truncate font-mono text-[11px] text-muted-foreground">{swatch.token}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({ labels }: { labels: Labels }) {
  return (
    <div className="space-y-8 rounded-2xl border border-border bg-background p-6 text-foreground">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{labels.panel}</h2>
        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {labels.scope}
        </span>
      </div>

      <SwatchGrid title={labels.surfaces} swatches={SURFACES} />
      <SwatchGrid title={labels.brand} swatches={BRAND} />
      <SwatchGrid title={labels.charts} swatches={CHARTS} />

      <section className="space-y-3">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {labels.typography}
        </h3>
        <div className="space-y-2">
          <p className="text-4xl font-semibold tracking-tight">{labels.displaySample}</p>
          <p className="text-2xl font-semibold tracking-tight">{labels.headingSample}</p>
          <p className="text-base">{labels.bodySample}</p>
          <p className="text-sm text-muted-foreground">{labels.smallSample}</p>
          <p className="font-mono text-xs text-muted-foreground">{labels.monoSample}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {labels.controls}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            {labels.primaryButton}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            {labels.secondaryButton}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            {labels.destructiveButton}
          </button>
          <button
            type="button"
            disabled
            className="inline-flex h-9 items-center rounded-md bg-muted px-3 text-sm font-medium text-muted-foreground"
          >
            {labels.disabledButton}
          </button>
          <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
            {labels.successBadge}
          </span>
        </div>
        <input
          type="text"
          placeholder={labels.emailPlaceholder}
          className="h-9 w-full max-w-sm rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p className="text-xs text-muted-foreground">{labels.note}</p>
      </section>
    </div>
  );
}

export default async function PreviewColorsPage() {
  const t = await getTranslations('preview');

  const shared = {
    surfaces: t('surfaces'),
    brand: t('brand'),
    charts: t('charts'),
    typography: t('typography'),
    controls: t('controls'),
    note: t('note'),
    displaySample: t('samples.display'),
    headingSample: t('samples.heading'),
    bodySample: t('samples.body'),
    smallSample: t('samples.small'),
    monoSample: t('samples.mono'),
    primaryButton: t('controlsSample.primary'),
    secondaryButton: t('controlsSample.secondary'),
    destructiveButton: t('controlsSample.destructive'),
    disabledButton: t('controlsSample.disabled'),
    successBadge: t('controlsSample.success'),
    emailPlaceholder: t('controlsSample.emailPlaceholder'),
  };

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('body')}</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        <Panel labels={{ ...shared, panel: t('light'), scope: t('scopeLight') }} />
        <div className="dark rounded-2xl border border-border bg-background p-1">
          <Panel labels={{ ...shared, panel: t('dark'), scope: t('scopeDark') }} />
        </div>
      </div>
    </main>
  );
}
