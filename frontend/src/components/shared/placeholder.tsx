import { ArrowLeft, Construction } from 'lucide-react';
import Link from 'next/link';

type PlaceholderProps = {
  badge: string;
  title: string;
  description: string;
  backLabel: string;
  backHref?: string;
};

/**
 * Shared body for the F0 placeholder routes. Every milestone replaces one of
 * these with the real page.
 */
export function Placeholder({
  badge,
  title,
  description,
  backLabel,
  backHref = '/',
}: PlaceholderProps) {
  // A plain `div`, not `<main id="main">`: this component is only ever rendered
  // inside a route-group layout, and all three of them (`(auth)`, `(main)`,
  // `(admin)`) already provide the single `<main id="main">` that the root
  // layout's skip-link targets. Owning it here produced nested `<main>` elements
  // and a duplicated id on every placeholder page.
  //
  // `flex-1`, not `min-h-dvh`: each layout puts a 64px header above this, so a
  // `100dvh` body would force a scrollbar on every placeholder page. Growing to
  // fill the parent keeps the vertical centring in a column layout, and
  // `mx-auto` centres it horizontally in a row one.
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        <Construction aria-hidden="true" className="size-3.5" />
        {badge}
      </span>

      <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
        {title}
      </h1>

      <p className="max-w-prose text-base leading-relaxed text-pretty text-muted-foreground">
        {description}
      </p>

      <Link
        href={backHref}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {backLabel}
      </Link>
    </div>
  );
}
