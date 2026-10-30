export default function Loading() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl space-y-4 px-6 py-16" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
    </main>
  );
}
