'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { AppApiError } from '@/lib/api/errors';

/**
 * Milliseconds before a successful response is considered stale. Small because
 * this is a social feed: 30s of staleness is invisible, and every mutation
 * invalidates its own keys explicitly.
 */
const STALE_TIME_MS = 30_000;

/** Unused cache is dropped after five minutes — long enough for back-navigation. */
const GC_TIME_MS = 5 * 60_000;

/**
 * Retry policy: 4xx means the request itself is wrong, so retrying it just
 * hammers the API. 5xx and transport failures are worth two more tries with
 * exponential backoff (TanStack's default delay).
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof AppApiError) {
    if (error.isClientError) return false;
    if (error.status === 0) return failureCount < 2;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC_TIME_MS,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        // A failed mutation may have already changed server state; never retry
        // writes automatically. The user is told, and can press the button again.
        retry: false,
      },
    },
  });
}

/**
 * Query cache provider, mounted once in the root layout. One `QueryClient` per
 * browser session: creating it during render would throw it away on every
 * re-render and silently lose the cache.
 *
 * (client একবারই — render-এ নতুন client বানালে cache প্রতিবার হারিয়ে যেত।)
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
