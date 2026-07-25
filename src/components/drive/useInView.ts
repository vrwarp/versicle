import { useEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * Fires once the element scrolls into view — the R4 lazy-hydration trigger
 * shared by the Drive shelf's grid card and list row (each one only pays for a
 * preview fetch when it is actually on screen).
 *
 * Deliberately latching: hydration is a one-way door (once a row has its cover
 * we never want to "un-hydrate" it), so the observer disconnects after the
 * first intersection instead of tracking visibility continuously. The infinite
 * scroll sentinel needs the opposite semantics and owns its own observer.
 */
export function useInView<T extends Element>(
  rootMargin = '200px',
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}
