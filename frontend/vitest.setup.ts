import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { server } from '@/mocks/server';

/**
 * Global test environment. Everything here is "make jsdom behave like a browser",
 * plus the MSW lifecycle so no test ever escapes to the real network.
 */
beforeAll(() => {
  // jsdom ships no matchMedia; next-themes reads it during mount.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  // Neither observer exists in jsdom. Infinite scroll (F7) observes real layout,
  // so tests assert on state changes, not on intersection callbacks firing.
  class NoopObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): [] {
      return [];
    }
  }
  window.ResizeObserver = NoopObserver as unknown as typeof ResizeObserver;
  window.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;

  // Unhandled requests are a test bug, not something to paper over silently.
  server.listen({ onUnhandledFrame: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
