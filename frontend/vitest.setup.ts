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

  // jsdom's Blob/File expose `arrayBuffer()`, `text()` and `bytes()` but no
  // `stream()` — a real browser has it, and undici's multipart writer reads each
  // `FormData` part through `blob.stream()`. Without it, a `fetch` whose body is
  // a jsdom `FormData` is written at a different length than the `content-length`
  // undici computed, and the request dies with
  // `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH` before MSW ever sees it — so media
  // upload tests could not exist. Environment parity, not a product change.
  if (typeof Blob.prototype.stream !== 'function') {
    Blob.prototype.stream = function stream(this: Blob) {
      // An arrow callback keeps the method's own `this` (the Blob) without
      // aliasing it to a local, which @typescript-eslint/no-this-alias rejects.
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: async (controller) => {
          controller.enqueue(new Uint8Array(await this.arrayBuffer()));
          controller.close();
        },
      });
    };
  }

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
