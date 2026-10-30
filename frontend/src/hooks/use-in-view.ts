'use client';

import { useEffect, useRef } from 'react';

/**
 * Calls `onVisible` when the returned ref enters the viewport.
 *
 * Used for the feed's scroll sentinel. Deliberately additive, never the ONLY
 * way to load more: the feed also renders a real button, because an
 * IntersectionObserver is invisible to keyboard users, screen readers and
 * browsers without it.
 *
 * `enabled` gates observation — while a page is already in flight there is
 * nothing to trigger, and observing would queue redundant fetches.
 */
export function useInView<T extends Element>(
  onVisible: () => void,
  enabled: boolean,
  rootMargin = '300px',
) {
  const elementRef = useRef<T | null>(null);
  // The callback closes over query state that changes every render, so hold it
  // in a ref. Re-subscribing the observer on each change would be pointless
  // churn: the observer only needs to know *when* the node appears.
  const callbackRef = useRef(onVisible);

  useEffect(() => {
    callbackRef.current = onVisible;
  });

  useEffect(() => {
    if (!enabled) return;

    const node = elementRef.current;
    // jsdom has no IntersectionObserver, and older browsers may not either.
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current();
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return elementRef;
}
